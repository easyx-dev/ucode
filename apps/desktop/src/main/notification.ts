/**
 * 系统通知：渲染层只递标题、正文与会话 id，凭证与窗口聚焦都留在主进程。
 *
 * 通知由渲染层的会话状态判定触发（等输入 / 完成 / 出错），点击后聚焦窗口并把会话 id 回传，
 * 由渲染层的导航状态切到那条会话。
 *
 * `notify` 如实回报系统有没有收下这条通知：macOS 未签名、Windows 缺 AppUserModelID 时系统只静默丢弃，
 * 不回报结果的话用户与开发者都无从察觉（界面那边据此提示「系统没放行」）。
 */
import { BrowserWindow, ipcMain, Notification } from "electron";

import {
  type DesktopNotificationRequest,
  NOTIFICATION_CLICK_CHANNEL,
  NOTIFY_CHANNEL,
} from "../shared/notification.ts";

/** 在展示中的系统通知：Electron 的对象被 GC 回收后事件不再触发，必须一直持有到关闭 */
const liveNotifications = new Set<Notification>();

/** 只有这两个平台会发 `show` / `failed`；其余平台没有可观测的投递结果，提交即视为送达 */
const reportsDelivery = process.platform === "darwin" || process.platform === "win32";

/** 等不到系统结论时的兜底：没有明确失败就按送达处理，免得把能用的通知误报成发不出去 */
const DELIVERY_TIMEOUT_MS = 3000;

/** 聚焦发起通知的窗口：通知到达时窗口可能在后台或已最小化 */
const focusWindow = (window: BrowserWindow): void => {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

/** 等系统给出结论：`show` 是送达，`failed` 是没能弹出（macOS 未签名、Windows 缺 AppUserModelID 都走这条） */
const waitForDelivery = (notification: Notification): Promise<boolean> =>
  new Promise((resolve) => {
    notification.once("show", () => resolve(true));
    notification.once("failed", () => resolve(false));
    // 事件不来时不能让渲染层的 await 一直挂着：超时按送达处理
    setTimeout(() => resolve(true), DELIVERY_TIMEOUT_MS);
  });

/**
 * 同一会话的通知共用一个 id（macOS 的 `identifier` / Windows 的 toast `Tag`）：
 * 等待输入 → 完成 → 出错连着来时后一条替换前一条，不堆成一串，与 web 端的 `tag` 语义一致。
 */
const notificationIdOf = (sessionId: string): string => `session-${sessionId}`;

export const registerNotificationIpc = (): void => {
  ipcMain.handle(NOTIFY_CHANNEL, (event, request: DesktopNotificationRequest) => {
    // 少数 Linux 桌面不支持系统通知，如实返回 false，渲染层静默降级
    if (!Notification.isSupported() || !request?.sessionId) return false;

    const notification = new Notification({
      id: notificationIdOf(request.sessionId),
      title: request.title,
      body: request.body,
      // 提示音由渲染层放（`@ucode/ui/business/notify/sound`，另有开关），系统再响一声就成了双响
      silent: true,
    });
    liveNotifications.add(notification);
    const forget = (): void => {
      liveNotifications.delete(notification);
    };
    // 先看窗口还在不在再取它：通知可能晚于点开它的那个窗口关闭，销毁的 WebContents 取不到窗口
    const sender = event.sender;
    notification.on("click", () => {
      forget();
      if (sender.isDestroyed()) return;
      const window = BrowserWindow.fromWebContents(sender);
      if (window) focusWindow(window);
      sender.send(NOTIFICATION_CLICK_CHANNEL, request.sessionId);
    });
    // 未点击就消失（超时 / 手动清除）时也要放开引用
    notification.on("close", forget);
    notification.show();
    return reportsDelivery ? waitForDelivery(notification) : true;
  });
};
