/**
 * 通知的呈现层：web 用浏览器的 Notification，桌面端走 preload 注入的系统通知桥。
 *
 * 「什么时候该通知」在 `lib/session-notice`，这里只管怎么发出、点击后怎么把会话 id 交回导航。
 * 发不出去（未授权 / 环境不支持 / 用户拒绝）一律静默降级：通知是补充通道，不该打断主流程。
 */
import { brand } from "@ucode/brand";

/** 通知开关的持久化键：纯本机界面偏好，不进服务端配置 */
const ENABLED_KEY = `${brand.slug}-notices-enabled`;

/** 一条通知的内容：标题是事件（等待输入 / 完成 / 出错），正文是会话标题 */
export type NoticeContent = {
  title: string;
  body: string;
  /** 点击后要回到的会话 */
  sessionId: string;
};

/**
 * 桌面桥的通知部分，形状与 `apps/desktop/src/shared/notification.ts` 一致（本包不依赖 electron，
 * 故按结构声明用得到的两个方法）。`notify` 返回主进程是否真的显示出了系统通知。
 */
export type DesktopNoticePort = {
  notify: (content: NoticeContent) => Promise<boolean>;
  onNotificationClick: (listener: (sessionId: string) => void) => () => void;
};

/** 取桌面桥；web 上的 `window.desktop` 不存在，退回浏览器通知 */
const readDesktopPort = (): DesktopNoticePort | null => {
  const port = (window as unknown as { desktop?: Partial<DesktopNoticePort> }).desktop;
  if (
    !port ||
    typeof port.notify !== "function" ||
    typeof port.onNotificationClick !== "function"
  ) {
    return null;
  }
  return port as DesktopNoticePort;
};

/** 通知开关：读不到（首次、隐私模式）按开启处理 */
export const readNoticeEnabled = (): boolean => {
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
};

export const writeNoticeEnabled = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // 写不进去（隐私模式）不影响本次会话
  }
};

/**
 * 浏览器通知：点击聚焦窗口并回到会话。
 * `tag` 让同一会话的通知互相替换——等待授权、完成、出错连着来的话，用户只需要看到最后一条。
 */
const showBrowserNotice = (content: NoticeContent, onSelect: (sessionId: string) => void): void => {
  try {
    const notice = new Notification(content.title, {
      body: content.body,
      tag: `session-${content.sessionId}`,
    });
    notice.onclick = () => {
      window.focus();
      onSelect(content.sessionId);
    };
  } catch {
    // 个别平台（未授权的移动端 Safari）构造即抛错
  }
};

/** 通知权限的四种可能：已允许 / 已拒绝 / 还没问过 / 环境不支持（含桌面桥已就绪的情形） */
export type NoticePermissionState = "granted" | "denied" | "default" | "unsupported";

/**
 * 当前能不能发通知：桌面桥恒为可以，未授权与不支持如实回报。
 * 设置页据此提示「还需要授权」。
 */
export const noticePermissionState = (): NoticePermissionState => {
  if (readDesktopPort()) return "granted";
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
};

/**
 * 请求通知授权，返回是否拿到。**必须在用户手势里调用**：Firefox 与 Safari 只允许手势内请求，
 * 而通知的触发时机是「页面不可见时的状态变化」，在那里请求会被静默忽略（Firefox）或抛错（Safari），
 * 于是权限永远停在 `default`、通知永远发不出去。
 */
export const requestNoticePermission = async (): Promise<boolean> => {
  const state = noticePermissionState();
  if (state === "granted") return true;
  if (state !== "default") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
};

/**
 * 发一条系统通知；发不出去就什么都不做（通知是补充通道，不该打断主流程）。
 * 浏览器端只认已授权的情形——授权由设置页在用户手势里申请（见 `requestNoticePermission`）。
 */
export const showNotice = (content: NoticeContent, onSelect: (sessionId: string) => void): void => {
  const desktop = readDesktopPort();
  if (desktop) {
    // 桌面端的点击由主进程回传（见 `subscribeNoticeClick`），这里不接 onSelect
    void desktop.notify(content).catch(() => false);
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  showBrowserNotice(content, onSelect);
};

/** 订阅通知点击；只有桌面端用得上（web 的通知点击是每条自己的 `onclick`），其余返回空退订 */
export const subscribeNoticeClick = (listener: (sessionId: string) => void): (() => void) =>
  readDesktopPort()?.onNotificationClick(listener) ?? (() => {});
