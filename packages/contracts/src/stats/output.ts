/**
 * 使用统计接口的响应模型：token 用量按模型与会话聚合，不计成本。
 *
 * 数据来自 pi 会话记录里各条目的 `usage`，口径与 pi 的 `getSessionStats()` 一致。
 */

/** 一段区间的 token 用量；`totalTokens` 为四类之和（与 pi 口径一致） */
export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

/**
 * 会话当前上下文占用：最近一次回答所在上下文的大小（该次请求的提示 + 回复），与模型窗口配对。
 *
 * 与 `UsageTotals` 的累计口径不同——累计用量只增不减，占用会随压缩回落。
 * 还没回答过、或刚压缩完还没出新回答时给不出这个值（见 `SessionInfoResponse.contextUsage`）。
 */
export type ContextUsage = {
  /** 上下文里的 token 数 */
  tokens: number;
  /** 该会话当前生效模型的上下文窗口 */
  contextWindow: number;
};

/** 按模型归并的用量；模型键为 `provider/model` */
export type ModelUsage = {
  provider: string;
  model: string;
  totals: UsageTotals;
};

/** 会话来源：普通主会话 / 子智能体 / 分叉会话 */
export type SessionUsageKind = "primary" | "subagent" | "forked";

/** 按会话归并的用量；已归档会话也计入，来源由 `kind` 标注 */
export type SessionUsageEntry = {
  sessionId: string;
  name: string | null;
  kind: SessionUsageKind;
  /** 归档时间；非空表示已归档，统计里仍计入，但界面不应再打开该会话 */
  deletedAt: string | null;
  totals: UsageTotals;
};

/** 全局统计：总量、工具调用次数，以及按模型 / 按会话两个维度 */
export type StatsSummaryResponse = {
  total: UsageTotals;
  /** assistant 消息里的工具调用总数 */
  toolCalls: number;
  byModel: ModelUsage[];
  bySession: SessionUsageEntry[];
};
