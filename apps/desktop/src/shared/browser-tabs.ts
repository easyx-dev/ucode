/** 浏览器标签上报的 IPC 约定（主进程与 preload 共用同一份，避免两处各写一个字面量） */

/** 渲染层上报整份标签列表用的频道；payload 是 `DesktopBrowserTab[]`（见 `@ucode/contracts`） */
export const BROWSER_TABS_CHANNEL = "desktop:browser-tabs";
