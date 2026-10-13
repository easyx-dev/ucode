/**
 * 上下文占用的运行期状态：压缩后的估算、最近一次压缩、装配期算出的压缩触发点。
 *
 * 这三份都是**进程内瞬时值**（有生命周期、要 `forget`），与「读文件解析出的基准」分开：
 * 它们只在会话跑着的时候有意义，服务重启后拿不到也不影响实测口径。
 * 读盘与 pi 都不在这里——基准由调用方算好传进来（`MeasuredContext`）。
 */
import type { ContextUsage } from "@ucode/contracts";

/** 取模型窗口与压缩触发点：都随运行时而变，由装配层注入 */
export type ContextResolvers = {
  /** 解析 `provider/model` 的上下文窗口；解析不到为 null */
  contextWindowOf: (modelRef: string | null) => number | null;
  /** 该模型的压缩触发点（与注入 pi 的阈值同源）；解析不到为 null */
  contextBudgetOf: (modelRef: string | null) => number | null;
};

/** 调用方算出的实测口径：池内会话问 pi，离线会话取文件解析出的基准；两者都可能没有 */
export type MeasuredContext = {
  /** 实测窗口；空时回落 `ContextResolvers.contextWindowOf` */
  window: number | null;
  /** 实测占用 token 数；没有可信基准时为 null */
  tokens: number | null;
};

export class ContextState {
  /**
   * 压缩后、还没有新回答时的上下文估算（pi 压缩结果里的 `estimatedTokensAfter`），按会话索引。
   */
  private readonly estimated = new Map<string, number>();
  /** 最近一次自动压缩：原因与时间，供界面说明「它为什么突然小了」 */
  private readonly compactions = new Map<string, { reason: string; at: number }>();
  /**
   * 装配时算出的压缩触发点（会话池写入）。**优先于按 `record.model` 的推算**：
   * 会话实际用的模型可能来自角色声明而不是记录上的覆盖，按记录推算会在「窗口来自实际模型、
   * 预算来自默认模型」之间对不上号。
   */
  private readonly budgets = new Map<string, number>();

  constructor(private readonly resolvers: ContextResolvers) {}

  /**
   * 上下文占用：实测优先，压缩后还没新回答时用压缩结果的估算顶替；
   * 两者都给不出、或窗口不可知时返回 null。
   */
  usageOf(
    sessionId: string,
    modelRef: string | null,
    measured: MeasuredContext,
  ): ContextUsage | null {
    const contextWindow = measured.window ?? this.resolvers.contextWindowOf(modelRef);
    const budget = this.budgets.get(sessionId) ?? this.resolvers.contextBudgetOf(modelRef);
    const lastCompaction = this.compactions.get(sessionId) ?? null;
    if (measured.tokens !== null && contextWindow !== null) {
      return { tokens: measured.tokens, contextWindow, estimated: false, budget, lastCompaction };
    }

    const estimated = this.estimated.get(sessionId);
    if (estimated !== undefined && contextWindow !== null) {
      return { tokens: estimated, contextWindow, estimated: true, budget, lastCompaction };
    }
    return null;
  }

  /** 记下装配时算出的压缩触发点；与注入 pi 的阈值同源，见 `harness/setup/budget` */
  rememberBudget(sessionId: string, triggerTokens: number): void {
    if (Number.isFinite(triggerTokens) && triggerTokens > 0) {
      this.budgets.set(sessionId, triggerTokens);
    }
  }

  /**
   * 记下一次压缩的结果：压缩后的估算规模 + 发生原因。
   * `tokens` 非法（非有限数 / 负数）时只记原因，不写估算——宁可继续给不出占用，也不要展示一个没意义的数。
   */
  rememberCompaction(
    sessionId: string,
    tokens: number,
    info?: { reason: string; at: number },
  ): void {
    if (Number.isFinite(tokens) && tokens >= 0) this.estimated.set(sessionId, tokens);
    if (info) this.compactions.set(sessionId, info);
  }

  /** 会话被释放（归档 / 删除 / 重建）时丢掉该会话的瞬时值，避免键无限累积 */
  forget(sessionId: string): void {
    this.estimated.delete(sessionId);
    this.compactions.delete(sessionId);
    this.budgets.delete(sessionId);
  }
}
