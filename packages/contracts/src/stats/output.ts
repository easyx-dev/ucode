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
 * 还没回答过时给不出这个值；压缩完成到新一轮回答之间只能给估算（见 `estimated`），
 * 连估算都没有时整体为空（见 `SessionInfoResponse.contextUsage`）。
 */
export type ContextUsage = {
  /** 上下文里的 token 数 */
  tokens: number;
  /** 该会话当前生效模型的上下文窗口 */
  contextWindow: number;
  /**
   * 是否为估算值：压缩会重写上下文，而压缩点之前那次回答的用量反映的是压缩前的规模，
   * 因此压缩完成到新一轮回答之间没有可信的实测值，只能用压缩结果里的估算规模顶替。
   */
  estimated: boolean;
  /**
   * 本次会话的压缩触发阈值（token）：到达它就自动压缩（见 `harness/budget`）。
   * 与窗口分开给出，因为触发点按「有效预算」算，不等于模型声明的窗口。
   */
  budget?: number | null;
  /** 最近一次自动压缩：原因与实际发生时间；没发生过为空 */
  lastCompaction?: { reason: string; at: number } | null;
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

/** 逐日 / 逐周用量桶里与时间无关的部分 */
export type UsageBucket = {
  totals: UsageTotals;
  /** 该桶内的调用次数（有 usage 的条目数），界面上记为「轮消息」；工具次数不计入 */
  messages: number;
};

/**
 * 逐日用量；`date` 为服务端本地时区的 `YYYY-MM-DD`。
 *
 * 查询带 `days` 时覆盖区间内每一天（无活动的日子为 0）；不带 `days` 时（全部时间）只返回有活动的日子。
 */
export type UsageDayBucket = UsageBucket & {
  date: string;
};

/** 逐周用量；`weekStart` 为该周周一的 `YYYY-MM-DD`（服务端本地时区）；覆盖规则同 `UsageDayBucket` */
export type UsageWeekBucket = UsageBucket & {
  weekStart: string;
};

/** 活跃度与连续天数；口径是全量历史，与查询的 `days` 无关 */
export type UsageStreak = {
  /** 当前连续天数：最新活跃日为今天或昨天时从该日往回数，否则为 0 */
  current: number;
  /** 历史最长连续天数 */
  longest: number;
  /** 有活动（至少一个用量点）的天数 */
  activeDays: number;
};

/** 区间内 token 最高的那一天 */
export type UsagePeakDay = {
  date: string;
  totalTokens: number;
};

/** 全局统计：总量、工具调用次数、按模型 / 按会话两个维度，以及仪表盘用的逐日 / 逐周序列与活跃度 */
export type StatsSummaryResponse = {
  total: UsageTotals;
  /** assistant 消息里的工具调用总数 */
  toolCalls: number;
  byModel: ModelUsage[];
  bySession: SessionUsageEntry[];
  /** 区间内的逐日用量；与 `total` 同口径，求和等于 `total.totalTokens` */
  daily: UsageDayBucket[];
  /** 区间内的逐周用量，由逐日结果按周一归并 */
  weekly: UsageWeekBucket[];
  /** 活跃度与连续天数（全量历史） */
  streak: UsageStreak;
  /** 区间内的峰值日；区间内没有用量时为 null */
  peak: UsagePeakDay | null;
  /**
   * 区间内「单会话最长聊天时长」（毫秒）：会话内相邻调用间隔不超过 30 分钟算同一段，
   * 各段时长累加即该会话的聊天时长，再取会话间的最大值；单点会话为 0。
   */
  longestSessionMs: number;
};
