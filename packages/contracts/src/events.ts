/** 事件流契约：全局 /events 的帧结构、事件名与序号语义 */

/**
 * 服务端事件名。新增需要跨连接同步的能力（权限、待办、会话列表变更等）时在此追加，
 * 前端订阅层按 type 过滤，不需要改动连接与重连逻辑。
 */
export const EVENT_NAMES = [
  "message_start",
  "text_delta",
  "thinking_delta",
  "tool_call",
  "tool_start",
  "tool_update",
  "tool_end",
  "message_end",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "session_info_changed",
  "agent_settled",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * 携带会话事件的帧。seq 是会话内单调序号：客户端订阅后按
 * 「messages/list 返回的快照 seq」切分，丢弃快照已含的帧、接续其余帧。
 */
export type ServerEventPayload = {
  type: EventName;
  sessionId: string;
  seq: number;
  data: unknown;
};

/** 控制帧：连接建立与服务端错误，不承载会话事件 */
export type ServerControlEvent =
  | { type: "server.connected" }
  | { type: "error"; sessionId?: string; code: string; message: string };

export type ServerEvent = ServerControlEvent | ServerEventPayload;
