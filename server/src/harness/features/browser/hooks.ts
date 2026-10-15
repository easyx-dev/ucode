/**
 * 装配层要用到的浏览器入口：只这一份类型，不含实现。
 *
 * 放在单独的文件里是为了让 `harness/setup`（装配）与 `harness/features/browser`（能力）
 * 都能引用它而不互相依赖：装配只注入，能力只消费。
 */
import type { BrowserConfig } from "@ucode/contracts";

import type { BrowserManagedMode, BrowserSession } from "./session";

/** 没接配置时的默认值：自己启动受管实例、临时数据目录 */
export const DEFAULT_BROWSER_SETTINGS: BrowserConfig = {
  mode: "isolated",
  endpoint: "",
  profile: "",
};

export type BrowserAcquireInput = {
  /** 引用者：pi 会话 id，会话回收时按它释放引用 */
  sessionId: string;
  profile: string;
  mode: BrowserManagedMode;
  /**
   * 模型是否**显式**要受管的浏览器（传了 profile / 端点 / 可执行文件 / 无头开关任一）。
   * 缺省按「没显式要」处理：这时若桌面端开着浏览器标签，驱动的是桌面端那一个（用户在看着它做事）。
   * 配置里的默认 profile 不算显式——它是「如果要用受管实例就用这份数据」，不是「必须起一个受管实例」。
   */
  managedRequested?: boolean;
  /** 显式指定的可执行文件（isolated 模式） */
  executablePath?: string;
  /** CDP 端点（attach 模式） */
  endpoint?: string;
  headless?: boolean;
  /**
   * 是否把这份 profile 的数据长期保留：为真时落在 `$APP_HOME/app/browser/profiles/<name>`（0700），
   * 跨会话保留登录态；为假（默认）时用临时目录，实例关掉即删。
   */
  persist?: boolean;
};

export type BrowserReleaseResult = {
  /** 引用归零后实例是否已经关掉 */
  closed: boolean;
  /** 还有几个会话在引用同一个 profile */
  remainingHolders: number;
};

/**
 * 没接入浏览器服务时的占位实现：这种会话压根不会注册浏览器工具，真被调到就说明装配漏了。
 */
export const NOOP_BROWSER_HOOKS: BrowserHooks = {
  acquire: () => {
    throw new Error("浏览器服务未接入");
  },
  current: () => {
    throw new Error("浏览器服务未接入");
  },
  release: () => ({ closed: false, remainingHolders: 0 }),
};

export type BrowserHooks = {
  /** 取（或建）该 profile 的实例；超过实例上限时报错 */
  acquire: (input: BrowserAcquireInput) => BrowserSession;
  /** 取本会话已经在用的实例；没有就报「还没打开页面」 */
  current: (sessionId: string) => BrowserSession;
  /**
   * 释放本会话对该 profile 的引用。`closeWhenUnused` 为真时（`browser_close` 的语义）
   * 在最后一个引用者离开后立即关掉实例，否则留给空闲回收。
   */
  release: (sessionId: string, options?: { closeWhenUnused?: boolean }) => BrowserReleaseResult;
};
