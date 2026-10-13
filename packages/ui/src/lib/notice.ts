/**
 * 通知的呈现层：web 用浏览器的 Notification，桌面端走 preload 注入的系统通知桥。
 *
 * 「什么时候该通知」在 `lib/session-notice`，这里只管怎么发出、点击后怎么把会话 id 交回导航。
 * 发不出去（未授权 / 环境不支持 / 用户拒绝）一律静默降级：通知是补充通道，不该打断主流程。
 */
import { brand } from "@ucode/brand/values";

import { readStorage, writeStorage } from "./storage";

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
  /**
   * 订阅窗口态（桌面壳的 preload 一律提供）。这里只用 `focused`：桌面端的「人在不在」看窗口焦点，
   * 不看页面可见性——Electron 的可见性只跟踪隐藏 / 最小化（仅 macOS 额外跟踪被完全遮挡），
   * 切到别的应用、窗口还露着时它仍是 `visible`，照它判定就一条通知都发不出去。
   */
  onWindowState?: (listener: (state: { focused: boolean }) => void) => () => void;
};

/**
 * 桌面窗口是否聚焦。取不到桥（web）时为 false——web 走页面可见性那条路，不看这个值。
 * 首次读桥时就把订阅挂上：窗口态只在变化时推送，晚挂会一直停在初始的「聚焦」上。
 */
let desktopFocused = true;
let focusTracked = false;

const trackDesktopFocus = (port: DesktopNoticePort): void => {
  if (focusTracked || !port.onWindowState) return;
  focusTracked = true;
  port.onWindowState((state) => {
    desktopFocused = state.focused;
  });
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
  trackDesktopFocus(port as DesktopNoticePort);
  return port as DesktopNoticePort;
};

/**
 * 「人是否在场」：web 看页面可见性（切标签页即离开），桌面端看窗口焦点。
 *
 * 两个平台的语义本来就不同，所以判定放在这里而不是调用方——否则 `use-session-notices`
 * 里会埋一个「Electron 上恒为在场」的隐形分支。
 */
export const isUserPresent = (): boolean => (readDesktopPort() ? desktopFocused : !document.hidden);

/** 通知开关：读不到（首次、隐私模式）按开启处理 */
export const readNoticeEnabled = (): boolean => readStorage(ENABLED_KEY) !== "0";

export const writeNoticeEnabled = (enabled: boolean): void =>
  writeStorage(ENABLED_KEY, enabled ? "1" : "0");

/**
 * 最近一次桌面通知的投递结果：`null` 表示这次运行还没发过。
 * 桌面端没有可主动查询的授权状态，只能按实际结果判断——设置页据此提示「系统没放行」。
 */
let desktopDelivered: boolean | null = null;

const deliveryListeners = new Set<() => void>();

export const readDesktopDelivered = (): boolean | null => desktopDelivered;

/** 订阅投递结果的变化；返回退订 */
export const subscribeDesktopDelivered = (listener: () => void): (() => void) => {
  deliveryListeners.add(listener);
  return () => {
    deliveryListeners.delete(listener);
  };
};

const recordDesktopDelivery = (delivered: boolean): void => {
  if (desktopDelivered === delivered) return;
  desktopDelivered = delivered;
  for (const listener of deliveryListeners) listener();
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
    // 桌面端的点击由主进程回传（见 `subscribeNoticeClick`），这里不接 onSelect；
    // 投递结果记下来，设置页据此判断系统是否真的让通知通过
    void desktop
      .notify(content)
      .then(recordDesktopDelivery)
      .catch(() => recordDesktopDelivery(false));
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  showBrowserNotice(content, onSelect);
};

/** 订阅通知点击；只有桌面端用得上（web 的通知点击是每条自己的 `onclick`），其余返回空退订 */
export const subscribeNoticeClick = (listener: (sessionId: string) => void): (() => void) =>
  readDesktopPort()?.onNotificationClick(listener) ?? (() => {});
