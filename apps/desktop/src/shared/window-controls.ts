/** 自绘窗口控件：渲染层只递动作，关窗 / 最小化 / 全屏 / 最大化都由主进程执行（主进程与渲染层共用同一形状） */
export const WINDOW_CONTROL_CHANNEL = "desktop:window-control";

/**
 * `zoom` 是「最大化 / 还原」：macOS 绿点的 ⌥ 变体（AppKit 里那颗钮本来就叫 zoom button）。
 * 全屏态下不送这个动作（渲染层按住 ⌥ 时也不会改送它）：全屏窗口不可缩放，要最大化得先退出全屏。
 */
export type WindowControlAction = "close" | "minimize" | "fullscreen" | "zoom";

/** 窗口态变化：控件失焦时整组置灰（macOS 的交通灯也这样），全屏时绿点换成「退出全屏」 */
export const WINDOW_STATE_CHANNEL = "desktop:window-state";

export type WindowState = {
  /** 窗口是否聚焦 */
  focused: boolean;
  /** 窗口是否全屏 */
  fullscreen: boolean;
};
