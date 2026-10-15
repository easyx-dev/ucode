/**
 * 浏览器能力：一组 pi 工具 + 装配入口。
 *
 * 装配层（`harness/setup/session-config`）只注入 `BrowserHooks`，不依赖 services；
 * 实例的归属、引用计数与空闲回收在 `registry.ts`，进程级门面在 `services/browser`。
 * 画面不再从这里推流：桌面端用内置 webview 承载浏览器，agent 直接驱动那一个页面（见 docs/browser.md）。
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { BrowserConfig } from "@ucode/contracts";

import { type BrowserHooks, DEFAULT_BROWSER_SETTINGS } from "./hooks";
import { createBrowserTools } from "./tools";

export type { BrowserAcquireInput, BrowserHooks, BrowserReleaseResult } from "./hooks";
export type { BrowserSession, BrowserSessionInput } from "./session";
export { BROWSER_TOOL_NAMES } from "./tools";

/**
 * 工具照旧注册、**不按模式裁剪**：只读模式（plan / ask）的阻断由 `WRITE_TOOLS` 派生的
 * `deny` 规则在调用时落地——切模式换工具表会被 pi 回放成工具表突变（见 `docs/modes-and-permissions.md`）。
 * 白名单会话（explore 之类）另在装配层按 `excludeTools` 排除。
 *
 * 只读模式给这一组留的是观察面（`BROWSER_OBSERVE_TOOL_NAMES`：打开 / 快照 / 截图 / 断开，
 * 打开页面沿用按站点审批）；`browser_act` 会改页面状态，只在受管实例里放行（`when: "managedBrowser"`，
 * 见 `agents/profiles`）——attach 与桌面端面板都驱动你自己的浏览器，仍阻断。
 */
export const createBrowserExtension =
  (input: {
    browser: BrowserHooks;
    /** 配置里的默认连接方式与默认 profile；缺省即「自己启动 + 临时目录」 */
    settings?: () => BrowserConfig;
  }): ExtensionFactory =>
  (pi) => {
    const settings = input.settings ?? (() => DEFAULT_BROWSER_SETTINGS);
    for (const tool of createBrowserTools(input.browser, settings)) pi.registerTool(tool);
  };
