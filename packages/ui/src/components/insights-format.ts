import type { MigrationPreflight, UsageBucket, UsageSummary } from "@ucode/sdk";

/**
 * 用量/迁移面板的**纯展示逻辑**（F-5.6~5.8）。
 *
 * token 数很大，直接显示会把面板撑爆；迁移预检的结论必须**一眼看出能不能迁**（
 * 而不是让人读一堆字段自己判断）——这两条都是"看着对不对"的核心，所以单独可测。
 */

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

/** 一行"模型 · 次数 · token"（面板按 token 数取前几名）。 */
export function topModelRows(
  summary: UsageSummary,
  limit = 5,
): { key: string; turns: number; tokens: string }[] {
  return [...summary.byModel]
    .sort((a, b) => b.input + b.output - (a.input + a.output))
    .slice(0, limit)
    .map((bucket) => ({
      key: bucket.key,
      turns: bucket.turns,
      tokens: formatTokenCount(bucket.input + bucket.output),
    }));
}

export function describeBucket(bucket: UsageBucket): string {
  return `${bucket.turns} 次 · ${formatTokenCount(bucket.input + bucket.output)} token`;
}

/** 预检结论压成一句话（能迁/不能迁 + 为什么）。 */
export function describePreflight(report: MigrationPreflight): string {
  if (!report.canMigrate) {
    return `不能迁移：${report.blockers.join("；") || "原因未知"}`;
  }
  const parts = [`可迁移：共 ${report.sessions.total} 条会话`];
  if (report.sessions.conflicts.length > 0) {
    parts.push(`其中 ${report.sessions.conflicts.length} 条与目标同名，默认跳过`);
  }
  if (report.warnings.length > 0) parts.push(report.warnings.join("；"));
  return `${parts.join("；")}。`;
}

/** 源/目标版本展示（null 表示不是可识别数据层）。 */
export function describeVersions(report: MigrationPreflight): string {
  const format = (value: number | null): string => (value === null ? "无法识别" : String(value));
  return `源版本 ${format(report.sourceVersion)} → 目标版本 ${format(report.targetVersion)}`;
}
