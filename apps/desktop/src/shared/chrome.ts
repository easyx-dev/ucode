/**
 * 窗口镶边：无标题栏窗口顶部的「标题条」几何（主进程与渲染层同一口径）。
 *
 * 只有 macOS 走无标题栏——系统标题栏去掉，系统红绿灯也一并隐藏（`setWindowButtonVisibility(false)`），
 * 关窗 / 最小化 / 缩放改由界面上的三颗点承担（`renderer/components/window-controls.tsx`）。
 * 位置由我们定，所以不需要迁就系统的灯位；其他平台保留系统边框与系统控件，这里的一切都不生效。
 */
export const isFrameless = (platform: NodeJS.Platform): boolean => platform === "darwin";

/**
 * 顶部为窗口控件让出的高度（px）：侧栏内容与全屏面板都从它下面开始。
 *
 * 取 48 是给控件留余量：控件的中线由布局实测报出（`--window-controls-center`），默认排布下它约在 29，
 * 点占 22–36，下面再留 12px，侧栏第一行不至于贴到点上；密度或字号调大后中线还会下移几像素，仍在 48 内。
 */
export const TITLE_BAR_INSET = 48;

/**
 * 自绘窗口控件的横向占位宽度（px），侧栏收起时对话区头部按它让位。
 *
 * 三颗点：左边距 20 + 点 14 × 3 + 点间距 8 × 2 + 尾部间隙 8 = 86。
 * 点尺寸固定（`size-window-control`，不随字号密度走），这个数字才是常量。
 */
export const WINDOW_CONTROLS_WIDTH = 86;
