/**
 * 自绘窗口控件：无标题栏窗口把系统红绿灯隐藏了（见 `main/index.ts`），
 * 关闭 / 最小化 / 缩放改由界面上的三颗点触发，动作在主进程执行。
 *
 * 动作作用在发起请求的那个窗口上——它是窗口自身的操作，不接受「当前窗口」这种全局口径。
 */
import { BrowserWindow, ipcMain } from "electron";

import {
  WINDOW_CONTROL_CHANNEL,
  WINDOW_FOCUS_CHANNEL,
  type WindowControlAction,
} from "../shared/window-controls.ts";

const apply = (window: BrowserWindow, action: WindowControlAction): void => {
  switch (action) {
    case "close":
      window.close();
      break;
    case "minimize":
      window.minimize();
      break;
    // macOS 的绿点就是「缩放」，再点一次还原
    case "zoom":
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      break;
  }
};

export const registerWindowControlsIpc = (): void => {
  ipcMain.on(WINDOW_CONTROL_CHANNEL, (event, action: WindowControlAction) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) apply(window, action);
  });
};

/**
 * 焦点变化告知渲染层：自绘控件不在系统管辖里，失焦置灰只能自己来。
 * 首帧也要报一次——渲染层默认按聚焦渲染，而窗口可能就在后台启动。
 */
export const watchWindowFocus = (window: BrowserWindow): void => {
  const report = (focused: boolean): void => {
    if (!window.webContents.isDestroyed()) window.webContents.send(WINDOW_FOCUS_CHANNEL, focused);
  };
  window.on("focus", () => report(true));
  window.on("blur", () => report(false));
  window.webContents.on("did-finish-load", () => report(window.isFocused()));
};
