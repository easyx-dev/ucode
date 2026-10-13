/**
 * 系统通知的跨进程契约：渲染层、preload 与主进程共用这一份形状。
 *
 * 渲染层负责文案（i18n 在 `@ucode/ui`），主进程只管弹系统通知与聚焦窗口；
 * 同形声明在 `@ucode/ui/business/notify/notice` 的 `DesktopNoticePort`——那边不能反过来依赖 electron。
 */
export type DesktopNotificationRequest = {
  /** 通知标题：事件本身（等待输入 / 完成 / 出错），已在渲染层按当前语言渲染 */
  title: string;
  /** 通知正文：会话标题 */
  body: string;
  /** 点击后要回到的会话 */
  sessionId: string;
};

/** 渲染层请求发通知 */
export const NOTIFY_CHANNEL = "desktop:notify";

/** 主进程回传通知点击（携带会话 id） */
export const NOTIFICATION_CLICK_CHANNEL = "desktop:notification-click";
