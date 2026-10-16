/** 平台相关展示与指针能力：修饰键标签（mac 用 ⌘，其余用 Ctrl+）、有没有可悬停的精确指针 */

/**
 * 是否有「可悬停的精确指针」（鼠标 / 触控板）。
 * 测试在 node 里跑，没有 window 时按有指针处理（桌面语义），免得判成触屏而改变键盘行为。
 */
export const canHoverPointer = (): boolean =>
  typeof window === "undefined" || window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * 触屏输入：软键盘没有 Shift，且换行键报的就是 `Enter`。
 * 凡是「回车 = 提交」的地方都要先问它——否则移动端换行会直接把内容发出去。
 */
export const isTouchInput = (): boolean => !canHoverPointer();

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export const MOD_KEY_LABEL = isMac ? "⌘" : "Ctrl+";
