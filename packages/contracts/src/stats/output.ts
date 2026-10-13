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

/**
 * 步级聚合：把 `ucode.step` 记录按「步」算出来的耗时画像。
 *
 * 步是「一次模型往返」，一轮用户输入下有若干步；耗时四段的口径见 `docs/session-entries.md`。
 * 取不到数的指标一律为空（不拿 0 冒充）——比如中断轮没有首帧锚点。
 */
export type StepUsageTotals = {
  /** 记录到耗时数据的步数 */
  steps: number;
  /** 有步的用户轮数（按 `userTurn` 去重） */
  turns: number;
  /** 平均每轮步数；没有步时为空 */
  stepsPerTurn: number | null;
  /** 单步总耗时：均值与两个分位（毫秒） */
  avgStepMs: number | null;
  p50StepMs: number | null;
  p90StepMs: number | null;
  /** 请求发出 → 响应头（含上传与排队）的均值 */
  avgFirstEventMs: number | null;
  /** 响应头 → 首个内容帧的均值（真正开始吐字前的静默） */
  avgTtftMs: number | null;
  /** 累计首帧延迟（含排队）占总耗时的比例；分母为 0 时为空 */
  ttftShare: number | null;
  /** 纯工具耗时（已扣掉等用户）占总耗时的比例；分母为 0 时为空 */
  toolShare: number | null;
  /** 步里的工具调用合计 */
  toolCalls: number;
  /** 以失败 / 中断收尾的步数（`stopReason` 为 `error` / `aborted`） */
  failedSteps: number;
  /** 缓存命中率：命中读 /（未命中输入 + 命中读）；分母为 0 时为空 */
  cacheHitRate: number | null;
};

/** 步级聚合的一个桶；`key` 的含义随维度而定（模型键、思考档位、`YYYY-MM-DD`） */
export type StepUsageBucket = {
  key: string;
  totals: StepUsageTotals;
};

/** 步级总览：整体 + 按模型 / 按思考档位 / 按日三个维度的分桶 */
export type StatsStepSummary = {
  total: StepUsageTotals;
  /** 按 `provider/model` 分桶，按步数降序 */
  byModel: StepUsageBucket[];
  /** 按思考档位分桶；取不到档位的步归 `unknown` */
  byThinking: StepUsageBucket[];
  /** 按服务端本地日期分桶（`YYYY-MM-DD`，只出有步的日） */
  daily: StepUsageBucket[];
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
  /** 区间内的步级耗时画像；区间内没有任何步记录时各指标为空 */
  steps: StatsStepSummary;
};
