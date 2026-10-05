/** 事件流契约：全局 /events 的帧结构、事件名与序号语义 */
import type { ConfigSnapshot } from "./config/output";
import type { McpListResponse } from "./mcp/output";

/**
 * 会话事件名（挂在 `ServerEventPayload` 上，带 sessionId 与 seq）。载荷约定：
 *
 * - 消息 / 工具 / 队列 / 压缩：会话消息流（`data` 见 `docs/api.md`「全局事件流」）
 * - `agent_settled`：`{}`，本轮（含排队的后续输入）结束
 * - `transcript_reset`：`{ fromEntryId }`，活动分支已改变，客户端应重取快照
 * - `interaction_request` / `interaction_resolved`：权限审批与提问
 * - `subagent_start` / `subagent_end`：子智能体与父会话 toolCall 的关联
 * - `goal_update`：`GoalView | null`
 * - `session_created`：`SessionSummary`，新建 / 分叉 / 子智能体创建
 * - `session_updated`：`{ session: SessionSummary; usage?: UsageTotals }`，
 *   改名 / 换模型 / 落定后摘要刷新 / 运行态变化；`usage` 仅在实际变化时带上
 * - `session_archived`：`{ sessionId }`，归档（级联子会话逐个下发）
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
  "agent_settled",
  "transcript_reset",
  "interaction_request",
  "interaction_resolved",
  "subagent_start",
  "subagent_end",
  "goal_update",
  "session_created",
  "session_updated",
  "session_archived",
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

/** 控制帧：连接、错误与全局（非会话）状态变更，不承载会话事件 */
export type ServerControlEvent =
  | { type: "server.connected" }
  | {
      type: "error";
      sessionId?: string;
      code: string;
      /** 中文兜底文案；客户端按 `code` 查 errorMessageKeys 渲染 */
      message: string;
      /** 渲染文案所需的插值值 */
      params?: Record<string, string>;
    }
  /** 配置已重建（模型运行时与内存会话都会重置）：客户端据此重取 models / health */
  | { type: "config_changed"; config: ConfigSnapshot }
  /** MCP 服务器配置变更：客户端据此刷新列表 */
  | { type: "mcp_changed"; mcp: McpListResponse };

export type ServerEvent = ServerControlEvent | ServerEventPayload;
