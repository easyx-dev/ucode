/** 窗口镶边：本窗口是否无系统标题栏，以及界面要为自绘窗口控件让出的空位 */
import { TITLE_BAR_INSET, WINDOW_CONTROLS_WIDTH } from "../../shared/chrome.ts";

/** 无系统标题栏（macOS）：系统红绿灯已收起，界面自己画窗口控件与拖拽区 */
export const isFramelessWindow = (): boolean => window.desktop.frameless;

/** 顶部为窗口控件让出的高度（px）：侧栏顶部与全屏面板按它下移；有系统标题栏时为 0 */
export const titleBarInset = (): number => (isFramelessWindow() ? TITLE_BAR_INSET : 0);

/** 自绘窗口控件的横向占位宽度（px）：侧栏收起时对话区头部按它右移；有系统标题栏时为 0 */
export const windowControlsWidth = (): number => (isFramelessWindow() ? WINDOW_CONTROLS_WIDTH : 0);
