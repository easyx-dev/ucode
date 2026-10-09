/**
 * 上下文预算：把模型声明的窗口换算成「压缩的触发点」与「压缩后保留多少」。
 *
 * pi 的判据是 `contextTokens > contextWindow - reserveTokens`，即触发点 = 窗口 − reserveTokens。
 * 默认的 reserveTokens（16384）在 1M 窗口下约等于永不触发，于是上下文一路涨到几百 k——
 * 而实测单步延迟随上下文线性上升（每 100k 约 +1.6s），越聊越慢。这里把触发点收到「有效预算」：
 * 按窗口留白算，再用一个绝对上限收住——不跟着窗口无上限地涨，同时给长任务留足容量。
 *
 * 触发点同时是 pi 摘要调用的输出预算口径（`min(0.8 × reserveTokens, model.maxTokens)`），
 * 所以大窗口模型下摘要的输出上限会被模型自身的 maxTokens 兜住，这是这套换算的已知耦合。
 */
import {
  CONTEXT_BUDGET_MAX_TOKENS,
  CONTEXT_BUDGET_RESERVE_MIN_TOKENS,
  CONTEXT_BUDGET_RESERVE_RATIO,
  CONTEXT_KEEP_MAX_TOKENS,
  CONTEXT_KEEP_MIN_TOKENS,
  CONTEXT_KEEP_RATIO,
} from "../constants";

export type ContextBudget = {
  /** 触发压缩的上下文 token 数 */
  triggerTokens: number;
  /** 压缩后原样保留的最近 token 数 */
  keepRecentTokens: number;
  /** 注入 pi 的 `compaction.reserveTokens`：窗口 − 触发点 */
  reserveTokens: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 计算预算。`override` 是配置里给单个模型写的 `contextBudget`
 * （应对「声明 1M、实际有效远低于此」的模型），留空按窗口推算。
 */
export const contextBudgetOf = (input: {
  contextWindow: number;
  override?: number | null;
}): ContextBudget => {
  const window = Math.max(1, Math.floor(input.contextWindow));
  // 给输出与下一批工具结果留白：按比例算，但小窗口下不能吃掉半个窗口
  const reserve = Math.min(
    Math.max(CONTEXT_BUDGET_RESERVE_MIN_TOKENS, Math.floor(window * CONTEXT_BUDGET_RESERVE_RATIO)),
    Math.floor(window / 2),
  );
  const ceiling = Math.max(1, window - reserve);
  const triggerTokens = clamp(
    input.override ?? ceiling,
    1,
    Math.min(ceiling, CONTEXT_BUDGET_MAX_TOKENS),
  );
  // 保留量必须明显小于触发点，否则压缩完立刻又要压
  const keepRecentTokens = Math.min(
    clamp(
      Math.floor(window * CONTEXT_KEEP_RATIO),
      CONTEXT_KEEP_MIN_TOKENS,
      CONTEXT_KEEP_MAX_TOKENS,
    ),
    Math.floor(triggerTokens / 2),
  );
  return { triggerTokens, keepRecentTokens, reserveTokens: window - triggerTokens };
};
