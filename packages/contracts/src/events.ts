/** 事件流契约：全局 /events 的帧结构、事件名与序号语义 */
import type { ConfigSnapshot } from "./config/output";
import type { McpListResponse } from "./mcp/output";

/**
 * 会话事件名（挂在 `ServerEventPayload` 上，带 sessionId 与 seq）。载荷约定：
 *
 * - 消息 / 工具 / 队列 / 压缩：会话消息流（`data` 见 `docs/api.md`「全局事件流」）
 * - `compaction_start`：`{ reason }`，`reason` 为 `manual` / `threshold` / `overflow`
 * - `compaction_end`：`{ reason, tokensBefore?, estimatedTokensAfter? }`，两个规模字段只在压缩成功时存在；
 *   压缩会重写可见历史（早期消息被摘要替代），服务端随后下发 `transcript_reset`。
 *   被**正常拒绝**时给 `{ reason, skipped }`（`CompactionSkipReason`）——没有可总结的跨度或已是压缩后的
 *   状态，不算失败、也不改变会话状态，界面只给一条轻提示。
 *   **自动压缩**失败时改为给 `{ reason, errorMessage }`：它不中断这一轮（pi 继续用原上下文跑），
 *   所以不能走 error 帧把会话标成「本轮出错」；手动压缩的失败仍走 error 帧（`compaction_failed`）
 * - `agent_settled`：`{}`，本轮（含排队的后续输入）结束
 * - `transcript_reset`：`{ fromEntryId }`，活动分支或可见历史已改变（编辑重发、追加界面标记、上下文压缩），
 *   客户端应重取快照
 * - `interaction_request` / `interaction_resolved`：权限审批与提问
 * - `subagent_start` / `subagent_end`：子智能体与父会话 toolCall 的关联
 * - `goal_update`：`GoalView | null`
 * - `session_created`：`SessionSummary`，新建 / 分叉 / 子智能体创建
 * - `session_updated`：`{ session: SessionSummary; usage?: UsageTotals; contextUsage?: ContextUsage | null }`，
 *   改名 / 换模型 / 落定后摘要刷新 / 运行态与状态变化；`usage` 在需要客户端重算占用的帧上带上（落定后、改模型 /
 *   模式），`contextUsage` 与它同帧。状态变化（`status`）由服务端给出，`running` 与它可能同时为真
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
  /** 配置已变更：模型运行时按需重建，内存会话在空闲后按新配置重装。客户端据此重取 models / health */
  | { type: "config_changed"; config: ConfigSnapshot }
  /** MCP 服务器配置变更：客户端据此刷新列表 */
  | { type: "mcp_changed"; mcp: McpListResponse };

export type ServerEvent = ServerControlEvent | ServerEventPayload;
