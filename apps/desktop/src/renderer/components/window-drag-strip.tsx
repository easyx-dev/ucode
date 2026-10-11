/**
 * 无标题栏窗口的拖拽区（宿主）：窗口左上角那一块，自绘窗口控件挂在它里面。
 *
 * 只在「服务不可用」态由入口渲染——工作区起来后，拖拽宿主由布局给（展开时是侧栏顶部那一条、
 * 收起时是对话区头部），控件跟着走（见 `components/window-controls.tsx` 的说明）。
 * 宽度取控件占的那一段（`WINDOW_CONTROLS_WIDTH`），高度取顶部让位（`TITLE_BAR_INSET`）。
 * 它在最上层（`z-chrome`）：弹层打开的遮罩不该盖住窗口控件，否则窗口关不掉也拖不动。
 */
import { titleBarInset, windowControlsWidth } from "../lib/window-chrome";
import { WindowControls } from "./window-controls";

export function WindowDragStrip() {
  return (
    <div
      className="window-drag fixed top-0 left-0 z-chrome"
      style={{ width: windowControlsWidth(), height: titleBarInset() }}
    >
      <WindowControls />
    </div>
  );
}
