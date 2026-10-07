/**
 * 手动压缩「正常拒绝」的识别。
 *
 * pi 的 `AgentSession.compact()` 在两种情况下不做任何事就报错：保留预算里装得下全部内容
 * （`Nothing to compact (session too small)`），或路径上已经是压缩后的状态（`Already compacted`）。
 * 这两种都不是失败——没做任何事、也不改变会话状态，应当只给用户一条轻提示。
 *
 * pi 只抛一个 `Error`，没有结构化原因，这里只能按文案识别；识别不到一律按失败处理：
 * 静默吞掉真失败（模型不可用、总结被中断）比多报一个错误糟糕得多。
 */
import type { CompactionSkipReason } from "@ucode/contracts";

export const compactionSkipReasonOf = (error: unknown): CompactionSkipReason | null => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Already compacted")) return "already_compacted";
  if (message.includes("Nothing to compact")) return "too_small";
  return null;
};
