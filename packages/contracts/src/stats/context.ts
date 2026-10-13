/** 会话上下文占用：与累计用量分开的一份口径（累计只增不减，占用会随压缩回落） */

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
   * 本次会话的压缩触发阈值（token）：到达它就自动压缩（见 `harness/setup/budget`）。
   * 与窗口分开给出，因为触发点按「有效预算」算，不等于模型声明的窗口。
   */
  budget?: number | null;
  /** 最近一次自动压缩：原因与实际发生时间；没发生过为空 */
  lastCompaction?: { reason: string; at: number } | null;
};
