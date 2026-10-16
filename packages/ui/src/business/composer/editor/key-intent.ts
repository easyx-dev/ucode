/**
 * 编辑器按键的归属判定。
 *
 * 单独一个模块，是为了它能被纯逻辑单测直接跑——`./extensions` 会连带 `.tsx` 组件与品牌资源，
 * 进不了 node 的测试链路（同 `./suggestion` 先把 `suggestionKeyActionOf` 抽出来的做法）。
 */

/** 一次按键的归属；`pass` 表示交回编辑器（换行 / 列表续行 / 其余按键） */
export type ComposerKeyIntent = "suggestion" | "escape" | "send" | "pass";

/** 判定要用的上下文：弹层是否开着、光标是否在列表项里、有没有 Esc 回调、是不是触屏输入 */
export type ComposerKeyContext = {
  suggestionOpen: boolean;
  inList: boolean;
  escape: boolean;
  touch: boolean;
};

/**
 * 按键 → 动作。
 *
 * 触屏上回车一律交回编辑器：软键盘的换行键报的就是 `Enter` 且没有 Shift，把「没有 Shift 的回车」
 * 当发送等于移动端每次换行都把消息发出去（判据见 `utils/platform` 的 `isTouchInput`）。
 */
export const composerKeyIntentOf = (
  event: { key: string; shiftKey?: boolean; isComposing?: boolean },
  context: ComposerKeyContext,
): ComposerKeyIntent => {
  // 弹层有候选时导航键让给弹层：Enter 选中当前项，而不是把消息发出去
  if (
    context.suggestionOpen &&
    ["Enter", "ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)
  ) {
    return "suggestion";
  }
  if (event.key === "Escape") return context.escape ? "escape" : "pass";
  if (context.touch) return "pass";
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    // 列表里 Enter 是续行 / 退出列表（空项回车即退出），退出后再按一次才发送
    return context.inList ? "pass" : "send";
  }
  return "pass";
};
