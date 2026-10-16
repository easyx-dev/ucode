/** pi 的 AgentSessionEvent → 对外事件流帧 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { EventName } from "@ucode/contracts";

import { messageToDTO, type ProjectionDeps, type TranscriptState } from "../harness/pi/serialize";

/** 事件名与数据的组合；总线负责补 sessionId 与 seq */
export type SseEvent = { event: EventName; data: Record<string, unknown> };

/** 投影一帧时由调用方补的信息 */
export type SseEventOptions = {
  /**
   * `message_end` 这一帧里消息的条目 id。
   *
   * pi 先发事件、后落盘（`appendMessage`），事件里拿不到条目 id，缺省时只能给个临时 id（界面拿
   * 条目 id 做编辑与分叉）；调用方通常在下一微任务里按消息对象身份把它查出来补上，见 `SessionEventBus`。
   */
  messageEntryId?: string;
  /** 投影依赖（图片落库）：实时帧的图片也要当场落，否则界面要等下一次刷新才取得到字节 */
  deps?: ProjectionDeps;
};

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
const toMessageEvents = (
  event: AgentSessionEvent,
  state: TranscriptState,
  options: SseEventOptions,
): SseEvent[] | null => {
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
        // 落盘前的退路：临时 id 只保证同一条消息在本次会话里可辨认，不是条目 id
        options.messageEntryId ?? `live-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        undefined,
        state,
        options.deps,
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
    case "compaction_end": {
      // 成功时给规模变化；失败时给 pi 的原因——自动压缩失败没有别的通道，不带给客户端
      // 用户就只能等下一轮超窗报错才知道上下文没压下去（手动压缩的失败另有 error 帧）
      const result = event.result;
      const errorMessage = event.errorMessage;
      return [
        {
          event: "compaction_end",
          data: {
            reason: event.reason,
            ...(result
              ? {
                  tokensBefore: result.tokensBefore,
                  estimatedTokensAfter: result.estimatedTokensAfter,
                }
              : errorMessage
                ? { errorMessage }
                : {}),
          },
        },
      ];
    }
    case "agent_settled":
      return [{ event: "agent_settled", data: {} }];
    // pi 的会话信息变更（如标题变化）不再单独下发：服务端在写入摘要后统一发 `session_updated`
    case "session_info_changed":
      return null;
    default:
      return null;
  }
};

export const toSseEvents = (
  event: AgentSessionEvent,
  state: TranscriptState = {},
  options: SseEventOptions = {},
): SseEvent[] =>
  toMessageEvents(event, state, options) ?? toToolEvents(event) ?? toSessionEvents(event) ?? [];
