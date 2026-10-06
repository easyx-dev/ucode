/** pi 的 AgentSessionEvent → 对外事件流帧 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { EventName } from "@ucode/contracts";

import { messageToDTO, type TranscriptState } from "./serialize";

/** 事件名与数据的组合；总线负责补 sessionId 与 seq */
export type SseEvent = { event: EventName; data: Record<string, unknown> };

type MessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;
type AssistantEvent = MessageUpdateEvent["assistantMessageEvent"];

const textFromResult = (result: unknown): string => {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;
  if (typeof result !== "object") return String(result);

  const record = result as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === "object" &&
        part !== null &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
    if (text) return text;
  }
  if (typeof record.text === "string") return record.text;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
};

/** 流式增量：正文、思考、工具调用参数 */
const toDeltaEvents = (inner: AssistantEvent): SseEvent[] => {
  switch (inner.type) {
    case "text_delta":
      return [{ event: "text_delta", data: { delta: inner.delta } }];
    case "thinking_delta":
      return [{ event: "thinking_delta", data: { delta: inner.delta } }];
    case "toolcall_end":
      return [
        {
          event: "tool_call",
          data: {
            toolCallId: inner.toolCall.id,
            toolName: inner.toolCall.name,
            args: inner.toolCall.arguments,
          },
        },
      ];
    default:
      return [];
  }
};

/** 消息相关事件 */
const toMessageEvents = (event: AgentSessionEvent, state: TranscriptState): SseEvent[] | null => {
  switch (event.type) {
    case "message_start":
      return [
        { event: "message_start", data: { role: (event.message as { role?: string }).role } },
      ];

    case "message_update":
      return toDeltaEvents(event.assistantMessageEvent);

    case "message_end": {
      const dto = messageToDTO(
        event.message,
        `live-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        undefined,
        state,
      );
      // 实时帧拿不到会话条目，用服务端当前时刻作为回复完成时间
      if (dto?.role === "assistant") dto.completedAt = new Date().toISOString();
      return dto ? [{ event: "message_end", data: dto }] : [];
    }

    default:
      return null;
  }
};

/** 工具执行事件 */
const toToolEvents = (event: AgentSessionEvent): SseEvent[] | null => {
  switch (event.type) {
    case "tool_execution_start":
      return [
        {
          event: "tool_start",
          data: { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args },
        },
      ];

    case "tool_execution_update":
      return [
        {
          event: "tool_update",
          data: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            text: textFromResult(event.partialResult),
          },
        },
      ];

    case "tool_execution_end":
      return [
        {
          event: "tool_end",
          data: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isError: event.isError,
            text: textFromResult(event.result),
          },
        },
      ];

    default:
      return null;
  }
};

/** 队列、压缩、会话信息与收尾事件 */
const toSessionEvents = (event: AgentSessionEvent): SseEvent[] | null => {
  switch (event.type) {
    case "queue_update":
      return [
        { event: "queue_update", data: { steering: event.steering, followUp: event.followUp } },
      ];
    case "compaction_start":
      return [{ event: "compaction_start", data: { reason: event.reason } }];
    case "compaction_end":
      return [{ event: "compaction_end", data: {} }];
    case "agent_settled":
      return [{ event: "agent_settled", data: {} }];
    // pi 的会话信息变更（如标题变化）不再单独下发：服务端在写入摘要后统一发 `session_updated`
    case "session_info_changed":
      return null;
    default:
      return null;
  }
};

export const toSseEvents = (event: AgentSessionEvent, state: TranscriptState = {}): SseEvent[] =>
  toMessageEvents(event, state) ?? toToolEvents(event) ?? toSessionEvents(event) ?? [];
