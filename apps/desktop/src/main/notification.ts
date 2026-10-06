/**
 * 系统通知：渲染层只递标题、正文与会话 id，凭证与窗口聚焦都留在主进程。
 *
 * 通知由渲染层的会话状态判定触发（等输入 / 完成 / 出错），点击后聚焦窗口并把会话 id 回传，
 * 由渲染层的导航状态切到那条会话。
 */
import { BrowserWindow, ipcMain, Notification } from "electron";

import {
  type DesktopNotificationRequest,
  NOTIFICATION_CLICK_CHANNEL,
  NOTIFY_CHANNEL,
} from "../shared/notification.ts";

/** 在展示中的系统通知：Electron 的对象被 GC 回收后事件不再触发，必须一直持有到关闭 */
const liveNotifications = new Set<Notification>();

/** 聚焦发起通知的窗口：通知到达时窗口可能在后台或已最小化 */
const focusWindow = (window: BrowserWindow): void => {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

export const registerNotificationIpc = (): void => {
  ipcMain.handle(NOTIFY_CHANNEL, (event, request: DesktopNotificationRequest): boolean => {
    // 少数 Linux 桌面不支持系统通知，如实返回 false，渲染层静默降级
    if (!Notification.isSupported() || !request?.sessionId) return false;

    const notification = new Notification({ title: request.title, body: request.body });
    liveNotifications.add(notification);
    const forget = (): void => {
      liveNotifications.delete(notification);
    };
    notification.on("click", () => {
      forget();
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) focusWindow(window);
      // 通知可能晚于点开它的那个窗口关闭
      if (!event.sender.isDestroyed()) {
        event.sender.send(NOTIFICATION_CLICK_CHANNEL, request.sessionId);
      }
    });
    // 未点击就消失（超时 / 手动清除）时也要放开引用
    notification.on("close", forget);
    notification.show();
    return true;
  });
};
