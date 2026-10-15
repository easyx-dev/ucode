/**
 * browser 域的响应模型：浏览器 profile 的数据面（设置页的列表与清理）。
 *
 * agent 用的那组工具不在这里——它们是会话内的工具调用，不是 HTTP 接口。
 * 画面也不在这里：桌面端用内置 webview 承载浏览器，用户直接看那个页面（见 docs/browser.md）。
 */

/** 一份 profile 的视图 */
export type BrowserProfileView = {
  /** 目录名，也是 `browser_open` 的 `profile` 入参取值 */
  name: string;
  /** 占用字节数；`exact` 为 false 时只是个下界 */
  bytes: number;
  /** 是否数完了整个目录（文件数或体积超过遍历上限即为 false） */
  exact: boolean;
  /** 最后一次改动时间（ISO）；取不到为 null */
  lastUsedAt: string | null;
  /** 是否正被某个浏览器实例持有（此时不能删） */
  inUse: boolean;
};

export type BrowserListResponse = {
  profiles: BrowserProfileView[];
  /** profile 存放根目录（设置页用它说明数据落在哪） */
  root: string;
  limits: {
    /** 持久化 profile 份数上限 */
    maxProfiles: number;
    /** 单份占用上限 */
    maxBytes: number;
  };
};

/** 删除结果：使用中的会被跳过，缺目录的原样报回，便于界面逐条对照 */
export type BrowserDeleteResponse = {
  deleted: string[];
  missing: string[];
  skipped: { name: string; reason: string }[];
};
