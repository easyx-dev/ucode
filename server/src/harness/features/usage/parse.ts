/**
 * 会话条目 → 用量点：token 用量、工具调用数与时间戳，外加按分支算出的上下文占用基准。
 *
 * 只认 pi 的条目形状（`message` / `usage` / `compaction` / `branch_summary`），不碰文件与聚合。
 * 口径与 pi 的 `getSessionStats()` 一致：合计 = input + output + cacheRead + cacheWrite。
 */
import {
  calculateContextTokens,
  getLastAssistantUsage,
  getLatestCompactionEntry,
  type SessionEntry,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { STEP_RECORD_CUSTOM_TYPE, type UsageTotals } from "@ucode/contracts";

import { isRecord } from "../../../utils/object";
import { emptyTotals, type StepPoint, type UsagePoint } from "./aggregate";

/** 从 pi 的 `Usage` 形状安全取出四类 token；缺失或非数字按 0 处理 */
export const readUsage = (value: unknown): UsageTotals => {
  if (!isRecord(value)) return emptyTotals();
  const num = (field: unknown): number =>
    typeof field === "number" && Number.isFinite(field) ? field : 0;
  const input = num(value.input);
  const output = num(value.output);
  const cacheRead = num(value.cacheRead);
  const cacheWrite = num(value.cacheWrite);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
  };
};

/** 条目时间：优先消息自身毫秒时间戳，回落条目 ISO 时间；都拿不到为 0 */
export const entryTimeMs = (entry: SessionEntry): number => {
  if (entry.type === "message") {
    const timestamp = (entry.message as { timestamp?: unknown }).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  }
  const parsed = Date.parse(entry.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** assistant 消息 content 里的工具调用数 */
const countToolCalls = (message: unknown): number => {
  if (!isRecord(message) || !Array.isArray(message.content)) return 0;
  return message.content.filter((part) => isRecord(part) && part.type === "toolCall").length;
};

/** 把会话条目解析成用量点；不含用量的条目被跳过 */
export const collectPoints = (entries: SessionEntry[]): UsagePoint[] => {
  const points: UsagePoint[] = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      // AgentMessage 是联合类型，这里按记录读取，避免对着判别联合做不安全的窄化
      const message = entry.message as unknown as Record<string, unknown>;
      if (message.role !== "assistant") continue;
      const totals = readUsage(message.usage);
      const toolCalls = countToolCalls(entry.message);
      if (totals.totalTokens === 0 && toolCalls === 0) continue;
      points.push({
        timeMs: entryTimeMs(entry),
        provider: typeof message.provider === "string" ? message.provider : null,
        model: typeof message.model === "string" ? message.model : null,
        totals,
        toolCalls,
      });
      continue;
    }
    if (entry.type === "usage") {
      const totals = readUsage(entry.usage);
      if (totals.totalTokens === 0) continue;
      points.push({
        timeMs: entryTimeMs(entry),
        provider: entry.provider,
        model: entry.model,
        totals,
        toolCalls: 0,
      });
      continue;
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      const totals = readUsage(entry.usage);
      if (totals.totalTokens === 0) continue;
      points.push({
        timeMs: entryTimeMs(entry),
        provider: null,
        model: null,
        totals,
        toolCalls: 0,
      });
    }
  }
  return points;
};

const STEP_FAILED_REASONS = new Set(["error", "aborted"]);

/** 从每步耗时条目的 `data` 取一个数；缺失 / 非数字给 null（区分「没有」与「是 0」） */
const nullableNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** 从每步耗时条目的 `data` 取一个字符串；缺失给 null */
const nullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * 把一条每步耗时条目（`STEP_RECORD_CUSTOM_TYPE`）的 `data` 解析成步级点；
 * 形状不对（缺时间锚点）时返回 null。
 *
 * 逐字段取值而不是直接断言：这些记录来自历史会话文件，一条坏记录不该让整份统计失效。
 */
export const stepPointOf = (entry: SessionEntry): StepPoint | null => {
  if (entry.type !== "custom" || entry.customType !== STEP_RECORD_CUSTOM_TYPE) return null;
  const data = entry.data;
  if (!isRecord(data)) return null;
  const startedAt = nullableNumber(data.startedAt);
  const endedAt = nullableNumber(data.endedAt);
  if (startedAt === null || endedAt === null) return null;
  const stopReason = nullableString(data.stopReason);
  return {
    at: endedAt,
    userTurn: nullableNumber(data.userTurn) ?? 0,
    provider: nullableString(data.provider),
    model: nullableString(data.model),
    // 思考档位在契约里是枚举，这里当字符串用：历史记录可能带已移除的档位
    thinkingLevel: nullableString(data.thinkingLevel),
    failed: stopReason !== null && STEP_FAILED_REASONS.has(stopReason),
    toolCalls: nullableNumber(data.toolCalls) ?? 0,
    totalMs: Math.max(0, endedAt - startedAt),
    firstEventMs: nullableNumber(data.firstEventMs),
    ttftMs: nullableNumber(data.ttftMs),
    streamMs: nullableNumber(data.streamMs),
    toolMs: nullableNumber(data.toolMs),
    userWaitMs: nullableNumber(data.userWaitMs) ?? 0,
    inputTokens: nullableNumber(data.inputTokens) ?? 0,
    cacheReadTokens: nullableNumber(data.cacheReadTokens) ?? 0,
  };
};

/** 从条目里挑出步级点；坏记录直接跳过 */
export const collectSteps = (entries: SessionEntry[]): StepPoint[] => {
  const steps: StepPoint[] = [];
  for (const entry of entries) {
    const point = stepPointOf(entry);
    if (point) steps.push(point);
  }
  return steps;
};

/**
 * 当前分支的上下文占用 token 数：最近一次可信回答所面对的上下文大小。
 *
 * 可信口径复用 pi 的 `getLastAssistantUsage()`（中断 / 出错 / 零值的回答都不算基准）；压缩会重写上下文，
 * 压缩点之前那条回答的用量反映的是压缩前的规模，因此只有压缩之后新出的回答才能当基准——压缩后还没回答时
 * 只能算未知，与 pi 的 `getContextUsage()` 一致。
 * 与它的差别：这里不估算基准回答之后追加的消息（pi 的 `estimateProjectedContextTokens` 会加上这部分），
 * 落定时最后一条就是那条回答、两者相等，基准回答之后还有消息时（排队输入、中断轮）pi 会略高。
 */
export const contextTokensOfBranch = (manager: SessionManager): number | null => {
  const branch = manager.getBranch();
  const compaction = getLatestCompactionEntry(branch);
  const afterCompaction = compaction ? branch.slice(branch.indexOf(compaction) + 1) : branch;
  const usage = getLastAssistantUsage(afterCompaction);
  return usage ? calculateContextTokens(usage) : null;
};
