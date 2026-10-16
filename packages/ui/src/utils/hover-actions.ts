/**
 * 悬停 / 聚焦才现的操作层（消息操作、表格工具条、代码块与图表的右上角按钮）。
 *
 * 触屏没有悬停态，只写 `group-hover` 等于这些入口在移动端「看得见但点不到」或干脆看不见，
 * 所以触屏下一律常驻。触发条件各处分歧（`group-hover` 与 `group-hover/code`、
 * `focus-within` 与 `focus-visible`），这里只收「隐藏 + 过渡 + 触屏常驻」，其余由调用方叠。
 */
export const HOVER_ACTION_CLASS =
  "opacity-0 transition-opacity [@media(pointer:coarse)]:opacity-100";
