/**
 * 自绘窗口控件：无标题栏窗口把系统红绿灯隐藏了（见 `main/index.ts`），
 * 关闭 / 最小化 / 全屏 / 最大化改由界面上的三颗点触发，动作在主进程执行。
 *
 * 动作作用在发起请求的那个窗口上——它是窗口自身的操作，不接受「当前窗口」这种全局口径。
 * 绿点的主动作是「全屏」（macOS 惯例），最大化是它的 ⌥ 变体；拖拽区双击也走系统那套，不由这里管。
 */
import { BrowserWindow, ipcMain } from "electron";

import {
  WINDOW_CONTROL_CHANNEL,
  WINDOW_STATE_CHANNEL,
  type WindowControlAction,
  type WindowState,
} from "../shared/window-controls.ts";

const apply = (window: BrowserWindow, action: WindowControlAction): void => {
  switch (action) {
    case "close":
      window.close();
      break;
    case "minimize":
      window.minimize();
      break;
    // 绿点进出全屏，再点一次还原
    case "fullscreen":
      window.setFullScreen(!window.isFullScreen());
      break;
    // 绿点的 ⌥ 变体：最大化 / 还原。渲染层已经拦下全屏态（全屏窗口不可缩放）
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
 * 窗口态下发给渲染层：自绘控件不在系统管辖里，失焦置灰与「进入 / 退出全屏」的符号只能自己判。
 * 首帧也要报一次——渲染层默认按聚焦、未全屏渲染，而窗口可能就在后台启动、或已经是全屏。
 */
export const watchWindowState = (window: BrowserWindow): void => {
  const report = (): void => {
    if (window.webContents.isDestroyed()) return;
    window.webContents.send(WINDOW_STATE_CHANNEL, {
      focused: window.isFocused(),
      fullscreen: window.isFullScreen(),
    } satisfies WindowState);
  };
  window.on("focus", report);
  window.on("blur", report);
  window.on("enter-full-screen", report);
  window.on("leave-full-screen", report);
  window.webContents.on("did-finish-load", report);
};
