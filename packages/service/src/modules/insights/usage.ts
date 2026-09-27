import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { servicePaths } from "../../paths.ts";
import { parseSessionFile } from "../../storage/index.ts";
/**
 * 用量统计（F-5.6）：**从会话记录里本地聚合**。
 *
 * 关键选择：不另建一张统计表。用量事实本来就随每次调用落在会话文件里（`usage` 记录、
 * 或助手消息自带的 `usage`），再维护一份副本只会带来"两份数据对不上"的经典问题。
 * 代价是每次统计要扫一遍会话文件——本机使用量级完全可接受，且永远与真相一致。
 */

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  /** 若供应商未给成本，这里是 0（用 token 数自己算更诚实）。 */
  cost: number;
};

export type UsageRecord = UsageTotals & {
  provider: string;
  modelId: string;
  /** 记录所在的本地日期（`YYYY-MM-DD`）。 */
  day: string | null;
};

export type UsageBucket = UsageTotals & { key: string; turns: number };

export type UsageSummary = {
  totals: UsageTotals;
  /** 按模型聚合。 */
  byModel: UsageBucket[];
  /** 按天聚合（只有能取到时间戳的记录才计入）。 */
  byDay: UsageBucket[];
  /** 参与聚合的记录条数。 */
  records: number;
};

const EMPTY_TOTALS: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  cost: 0,
};

function numberOr(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 从一条记录里抽用量（容错：供应商/基座字段命名有出入，取不到就当没有）。 */
export function extractUsage(entry: Record<string, unknown>): UsageRecord | null {
  const usage = (entry.usage ?? (entry.message as Record<string, unknown> | undefined)?.usage) as
    | Record<string, unknown>
    | undefined;
  if (typeof usage !== "object" || usage === null) return null;

  const cost = usage.cost as { total?: unknown } | number | undefined;
  const costValue =
    typeof cost === "number" ? cost : typeof cost?.total === "number" ? cost.total : 0;

  const message = entry.message as Record<string, unknown> | undefined;
  const provider = String(entry.provider ?? message?.provider ?? "unknown");
  const modelId = String(entry.modelId ?? (entry.model as unknown) ?? message?.model ?? "unknown");
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;

  return {
    input: numberOr(usage.input),
    output: numberOr(usage.output),
    cacheRead: numberOr(usage.cacheRead),
    cacheWrite: numberOr(usage.cacheWrite),
    reasoning: numberOr(usage.reasoning),
    cost: costValue,
    provider,
    modelId,
    day: timestamp === undefined ? null : timestamp.slice(0, 10),
  };
}

export function aggregateUsage(records: readonly UsageRecord[]): UsageSummary {
  const totals: UsageTotals = { ...EMPTY_TOTALS };
  const byModel = new Map<string, UsageBucket>();
  const byDay = new Map<string, UsageBucket>();

  const add = (map: Map<string, UsageBucket>, key: string, record: UsageRecord): void => {
    const bucket = map.get(key) ?? { key, turns: 0, ...EMPTY_TOTALS };
    bucket.turns += 1;
    bucket.input += record.input;
    bucket.output += record.output;
    bucket.cacheRead += record.cacheRead;
    bucket.cacheWrite += record.cacheWrite;
    bucket.reasoning += record.reasoning;
    bucket.cost += record.cost;
    map.set(key, bucket);
  };

  for (const record of records) {
    totals.input += record.input;
    totals.output += record.output;
    totals.cacheRead += record.cacheRead;
    totals.cacheWrite += record.cacheWrite;
    totals.reasoning += record.reasoning;
    totals.cost += record.cost;
    add(byModel, `${record.provider}/${record.modelId}`, record);
    if (record.day !== null) add(byDay, record.day, record);
  }

  return {
    totals,
    byModel: [...byModel.values()].sort((a, b) => b.input + b.output - (a.input + a.output)),
    byDay: [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    records: records.length,
  };
}

/** 扫描数据层里所有会话文件，聚合用量。 */
export async function collectUsageStats(dataDir: string): Promise<UsageSummary> {
  const records: UsageRecord[] = [];
  for (const file of await listSessionFiles(servicePaths(dataDir).sessions)) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const { entry } of parseSessionFile(content).entries) {
      const record = extractUsage(entry as unknown as Record<string, unknown>);
      if (record !== null) records.push(record);
    }
  }
  return aggregateUsage(records);
}

/** 会话文件在 `<sessions>/<bucket>/<file>.jsonl` 下（buckets 由业务目录名派生）。 */
export async function listSessionFiles(sessionsRoot: string): Promise<string[]> {
  const files: string[] = [];
  let buckets: string[];
  try {
    buckets = await readdir(sessionsRoot);
  } catch {
    return files;
  }
  for (const bucket of buckets) {
    let names: string[];
    try {
      names = await readdir(join(sessionsRoot, bucket));
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".jsonl")) files.push(join(sessionsRoot, bucket, name));
    }
  }
  return files;
}

/** 一行可读摘要（CLI/UI 直接显示）。 */
export function summarizeUsage(summary: UsageSummary): string {
  const { totals } = summary;
  const tokens = totals.input + totals.output;
  const parts = [
    `共 ${summary.records} 次调用，输入 ${totals.input} / 输出 ${totals.output} token`,
    totals.cacheRead + totals.cacheWrite > 0
      ? `缓存读 ${totals.cacheRead} / 写 ${totals.cacheWrite}`
      : "",
    totals.cost > 0 ? `成本 ${totals.cost.toFixed(4)}` : "",
    `合计 ${tokens} token`,
  ];
  return `${parts.filter((part) => part !== "").join("；")}。`;
}
