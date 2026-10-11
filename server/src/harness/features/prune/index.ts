/**
 * 旧工具输出清理：把「还在上下文里、但已经用不上」的工具结果换成一行占位，给上下文腾出空间。
 *
 * 为什么需要它：压缩（摘要）是无界增长的唯一终局手段，但每次压缩都要跑一次全量摘要调用，
 * 代价高、还会丢细节。而实测上下文里最大的那块是工具输出本身（4 个真实会话 8.9MB 工具输出里
 * `read` 占 4.06MB），它们大多只用一次。于是按 opencode 的节奏做一层「清除」：
 * 保留最近若干轮与最近 40k token 的工具输出，更早的只留一行占位。
 *
 * 两个硬约束：
 * - **保留消息本身、只换正文**（`replacement` 给占位文本而不是 `null`）：tool-call 与结果必须配对，
 *   整条抹掉会让下一轮请求的配对被供应商拒绝；
 * - **批量清，而不是每轮抠一点**：改动历史会打断前缀缓存，碎片式清理等于每轮都断一次，
 *   所以清出的量不到阈值就不动（见 `PRUNE_MIN_CLEARED_TOKENS`）。
 */
import type { SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";

import {
  PRUNE_MAX_EDITS_PER_PASS,
  PRUNE_MIN_CLEARED_TOKENS,
  PRUNE_PLACEHOLDER,
  PRUNE_PROTECT_TOKENS,
  PRUNE_PROTECTED_TOOLS,
  PRUNE_PROTECTED_USER_TURNS,
} from "../../../constants/session";
import { logger } from "../../../platform/logger";

/**
 * 粗略 token 估算：4 字符 ≈ 1 token，与 pi / opencode 同档（便于两边阈值可比）。
 * 注意偏差方向：中文与中文注释按这个口径会**低估**（实际约 1 字 1 token），
 * 所以中文密集的工具输出下，40k 保护窗口与 20k 清理阈值都偏松——它是启发式，不当硬保证用。
 */
const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

/** 图片块按固定值粗估：真实开销由供应商按分块算，这里只要一个量级正确的数 */
const IMAGE_BLOCK_TOKEN_ESTIMATE = 1_000;

export type PruneOutcome = {
  /** 被清理的工具结果条数 */
  cleared: number;
  /** 估算腾出的 token 数 */
  freedTokens: number;
  /** 被清掉的条目：id 与当时的工具名，落在会话文件里供事后对账 */
  targets: Array<{ id: string; tool: string }>;
};

const contentCost = (content: unknown): number => {
  if (typeof content === "string") return estimateTokens(content.length);
  if (!Array.isArray(content)) return 0;
  let tokens = 0;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") {
      tokens += estimateTokens(record.text.length);
      continue;
    }
    if (record.type === "image") tokens += IMAGE_BLOCK_TOKEN_ESTIMATE;
  }
  return tokens;
};

const isReplaceable = (
  entry: SessionEntry,
): entry is SessionEntry & {
  message: { role: "toolResult"; toolName: string; content: unknown };
} => {
  if (entry.type !== "message") return false;
  const message = entry.message as { role?: unknown; toolName?: unknown; content?: unknown };
  return message.role === "toolResult" && typeof message.toolName === "string";
};

/**
 * 清理一个会话里过期的工具输出。返回是否真的清了东西，供调用方决定要不要提示。
 * 纯同步：只读条目 + 追加 `context_edit`，不触发模型调用。
 */
export const pruneToolOutputs = (manager: SessionManager): PruneOutcome => {
  const branch = manager.getBranch();
  const edited = new Set(
    branch.flatMap((entry) => (entry.type === "context_edit" ? [entry.targetId] : [])),
  );
  const candidates: Array<{ id: string; tool: string; tokens: number }> = [];
  let protectedTokens = PRUNE_PROTECT_TOKENS;
  let userTurns = 0;

  // 从最新往回扫：先跳过最近两轮与最近的 40k 工具输出，剩下的才是清理对象
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry) continue;
    // 压缩点之前的条目本来就不进上下文，再往前扫没有意义
    if (entry.type === "compaction") break;
    if (!isReplaceable(entry)) {
      if (entry.type === "message" && entry.message.role === "user") userTurns += 1;
      continue;
    }
    if (userTurns < PRUNE_PROTECTED_USER_TURNS) continue;
    const { toolName, content } = entry.message;
    if (PRUNE_PROTECTED_TOOLS.includes(toolName)) continue;
    if (edited.has(entry.id)) continue;
    const tokens = contentCost(content);
    if (tokens === 0) continue;
    if (protectedTokens > 0) {
      protectedTokens -= tokens;
      continue;
    }
    candidates.push({ id: entry.id, tool: toolName, tokens });
    // 一次别清太多：每条都是一次同步落盘，剩下的留给下一轮
    if (candidates.length >= PRUNE_MAX_EDITS_PER_PASS) break;
  }

  const freedTokens = candidates.reduce((sum, item) => sum + item.tokens, 0);
  if (freedTokens < PRUNE_MIN_CLEARED_TOKENS) return { cleared: 0, freedTokens: 0, targets: [] };

  let cleared = 0;
  const targets: Array<{ id: string; tool: string }> = [];
  for (const candidate of candidates) {
    try {
      manager.appendContextEdit(candidate.id, {
        content: [{ type: "text", text: PRUNE_PLACEHOLDER }],
      });
      cleared += 1;
      targets.push({ id: candidate.id, tool: candidate.tool });
    } catch (error) {
      // 单条失败不该中断整轮清理：已经清掉的仍然有效
      logger.warn({ error }, "清理旧工具输出失败");
    }
  }
  return { cleared, freedTokens, targets };
};
