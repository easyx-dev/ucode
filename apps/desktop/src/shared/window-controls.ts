/** 自绘窗口控件：渲染层只递动作，关窗 / 最小化 / 缩放都由主进程执行（主进程与渲染层共用同一形状） */
export const WINDOW_CONTROL_CHANNEL = "desktop:window-control";

export type WindowControlAction = "close" | "minimize" | "zoom";

/** 窗口焦点变化：控件失焦时置灰（macOS 的交通灯也这样） */
export const WINDOW_FOCUS_CHANNEL = "desktop:window-focus";
