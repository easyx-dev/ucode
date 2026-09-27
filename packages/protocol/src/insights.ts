/**
 * 用量统计 / 支持包导出 / 数据迁移的**线上形状**（F-5.6~5.8）。
 *
 * 与 channels 的查询结果一样：服务层是产出方，控制层据此渲染；这里只放类型，
 * 因为这些结果本来就是服务层算出来的派生数据，不需要（也不该）在协议层再校验一遍。
 */

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
};

export type UsageBucket = UsageTotals & { key: string; turns: number };

export type UsageSummary = {
  totals: UsageTotals;
  byModel: UsageBucket[];
  byDay: UsageBucket[];
  records: number;
};

/**
 * `stats.usage` 的结果。
 *
 * 放在协议里而不是让服务端与 SDK 各写一份内联类型：两边的字段必须**同名**，
 * 否则控制层读到 `undefined` 还以为"没有用量"（实测踩到过：服务端回 `usage`、
 * 控制层读 `summary`，用量面板永远空着）。
 */
export type UsageStatsResult = {
  summary: UsageSummary;
  /** 给人看的一句话汇总（控制层直接显示，不必自己拼）。 */
  readable: string;
};

export type MigrationConflict = { sessionId: string; file: string; reason: "exists" };

export type MigrationPreflight = {
  source: string;
  target: string;
  sourceVersion: number | null;
  targetVersion: number | null;
  canMigrate: boolean;
  sessions: { total: number; conflicts: MigrationConflict[] };
  warnings: string[];
  blockers: string[];
};

export type SupportBundleResult = {
  file: string;
  bytes: number;
  /** 包里带了哪些部分（如实列出，用户知道自己在分享什么）。 */
  included: string[];
};

export type MigrationImportResult = { copied: number; skipped: number };
