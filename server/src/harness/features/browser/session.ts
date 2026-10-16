/**
 * 一份 profile 的浏览器实例：launch / attach 双模式、懒启动、快照与动作、截图。
 *
 * 刻意不做自动重试与自动等待（源方案 §3）：超时即失败，把原因与下一步写进错误里交给模型。
 * 实例的归属与回收归注册表管（引用计数 + 空闲 TTL），本文件只管「怎么开、怎么动、怎么关」。
 */
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
} from "playwright-core";

import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_LAUNCH_TIMEOUT_MS,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_REF_ATTRIBUTE,
  BROWSER_SCREENSHOT_QUALITY,
  BROWSER_VIEWPORT,
} from "../../../constants/browser";
import {
  type BrowserActInput,
  formatEvalResult,
  normalizeRef,
  type ResolvedAct,
  resolveAct,
  scrollDelta,
  toEvalError,
} from "./actions";
import { detectFailureMessage, resolveBrowser } from "./detect";
import { browserError, toBrowserError } from "./errors";
import {
  assertRefActionable,
  assertRefInSnapshot,
  captureSnapshot,
  documentChanged,
  type Evaluate,
  readDocumentOrigin,
} from "./page-ops";
import { evalScript } from "./page-scripts";
import type { SnapshotEntry } from "./snapshot";

/** 受管实例的两种模式：配置里可选的就是这两种（见 `BrowserConfig.mode`） */
export type BrowserManagedMode = "isolated" | "attach";

/**
 * 会话模式：比受管实例多一个 `desktop`——那一个是桌面端面板里的标签，不由我们启动、也不归我们关
 * （见 `desktop/session.ts`）。
 */
export type BrowserMode = BrowserManagedMode | "desktop";

export type BrowserSessionInput = {
  profile: string;
  mode: BrowserManagedMode;
  /** 显式指定的可执行文件（isolated 模式） */
  executablePath?: string;
  /** CDP 端点（attach 模式） */
  endpoint?: string;
  /** 缺省无头；调试观测时可以置 false */
  headless?: boolean;
  /**
   * 持久化数据目录：给了就按 `launchPersistentContext` 打开（登录态跨会话保留），
   * 不给则用临时目录、实例关掉即删。目录与权限由 `profiles.ts` 准备。
   */
  userDataDir?: string;
};

export type OpenResult = { url: string; title: string };
export type SnapshotResult = {
  text: string;
  /** 因为条数或字符上限被截断 */
  truncated: boolean;
  /** 页面上的元素总数 */
  count: number;
  url: string;
  title: string;
};
export type ActResult = { summary: string; url: string; navigated: boolean };
export type ScreenshotResult = { data: string; mimeType: string; url: string };

export type BrowserSession = {
  readonly profile: string;
  readonly mode: BrowserMode;
  open: (input: { url: string }) => Promise<OpenResult>;
  snapshot: (input: { diff?: boolean; compact?: boolean }) => Promise<SnapshotResult>;
  act: (input: BrowserActInput) => Promise<ActResult>;
  screenshot: (input: { fullPage?: boolean; ref?: string }) => Promise<ScreenshotResult>;
  /** 当前地址；没开页面时为 null */
  currentUrl: () => string | null;
  /** 关掉实例（attach 模式只断开，不关用户的浏览器） */
  close: () => Promise<void>;
  isOpen: () => boolean;
  /** 正在执行工具调用：空闲清扫不碰它 */
  isBusy: () => boolean;
  beginUse: () => void;
  endUse: () => void;
  idleMs: (now?: number) => number;
};

const noop = (): void => undefined;

export const createBrowserSession = (input: BrowserSessionInput): BrowserSession => {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let entries: SnapshotEntry[] = [];
  /**
   * 最近一次快照所在文档的身份。**故意不监听 `framenavigated`**：Playwright 对 `pushState` 这类同文档导航
   * 也会触发它，拿它清表会让 SPA 里每次路由跳转都白丢一次快照；真失效由 `snapshot` 的文档身份判断与
   * 页面上的 `BROWSER_REF_ATTRIBUTE` 属性（新文档里没有，命中检测报缺失）两处兜住。
   */
  let documentOrigin: number | null = null;
  let lastUsedAt = Date.now();
  let activeCalls = 0;

  const requireExecutable = (): string => {
    const found = resolveBrowser(input.executablePath);
    if (!found.browser) {
      throw browserError("browser_not_installed", detectFailureMessage(found), {
        hint: "装一个 Chrome / Edge / Chromium，或在 browser_open 里传 executablePath",
      });
    }
    return found.browser.path;
  };

  /** 临时目录：实例关掉即删，不碰用户任何数据 */
  const launchEphemeral = async (): Promise<void> => {
    const launched = await chromium.launch({
      headless: input.headless ?? true,
      executablePath: requireExecutable(),
      timeout: BROWSER_LAUNCH_TIMEOUT_MS,
    });
    browser = launched;
    context = await launched.newContext({ viewport: { ...BROWSER_VIEWPORT } });
  };

  /** 持久化目录：登录态留在磁盘上（cookie / localStorage 都在里面），目录已按 0700 建好 */
  const launchPersistent = async (userDataDir: string): Promise<void> => {
    let launched: BrowserContext;
    try {
      launched = await chromium.launchPersistentContext(userDataDir, {
        headless: input.headless ?? true,
        executablePath: requireExecutable(),
        viewport: { ...BROWSER_VIEWPORT },
        timeout: BROWSER_LAUNCH_TIMEOUT_MS,
      });
    } catch (error) {
      throw browserError("action_failed", `打开 profile 失败：${userDataDir}`, {
        hint: "同一份 profile 不能被两个浏览器实例同时打开；确认没有别的会话或你手工开的浏览器在用",
        cause: error,
      });
    }
    context = launched;
    browser = launched.browser();
  };

  const connectExisting = async (endpoint: string): Promise<void> => {
    let connected: Browser;
    try {
      connected = await chromium.connectOverCDP(endpoint, { timeout: BROWSER_LAUNCH_TIMEOUT_MS });
    } catch (error) {
      throw browserError("attach_failed", `连接 ${endpoint} 失败`, {
        hint: "确认那个实例还活着、端口对得上（它必须带 --remote-debugging-port 启动，默认 profile 目录会被 Chrome 拒绝）",
        cause: error,
      });
    }
    browser = connected;
    // 只操作我们新建的 page：用户已有的标签不动（否则 agent 会抢用户正在看的页面）
    context = connected.contexts()[0] ?? (await connected.newContext());
  };

  /** 首次使用时才真的开进程：只做只读调研的会话不该占着浏览器 */
  const ensurePage = async (): Promise<Page> => {
    if (page) return page;
    if (!browser) {
      if (input.mode === "attach") {
        if (!input.endpoint) {
          throw browserError("attach_failed", "attach 模式缺少端点", {
            hint: "在 browser_open 里传 cdpEndpoint，或用 isolated 模式让我们自己启动",
          });
        }
        await connectExisting(input.endpoint);
      } else if (input.userDataDir) {
        await launchPersistent(input.userDataDir);
      } else {
        await launchEphemeral();
      }
    }
    const live = context;
    if (!live)
      throw browserError("action_failed", "浏览器上下文不可用", { hint: "重新 browser_open" });
    // 持久化 profile 打开时自带一个初始页（那是我们的），attach 模式则必须新建、不能接管用户的标签
    const created =
      input.mode === "attach" ? await live.newPage() : (live.pages()[0] ?? (await live.newPage()));
    created.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS);
    created.setDefaultNavigationTimeout(BROWSER_NAVIGATION_TIMEOUT_MS);
    page = created;
    return created;
  };

  const requirePage = (): Page => {
    if (!page) {
      throw browserError("browser_not_open", "还没有打开页面", {
        hint: "先调用 browser_open 打开一个地址",
      });
    }
    return page;
  };

  const titleOf = async (target: Page): Promise<string> => target.title().catch(() => "");

  /** 页面求值：两条传输共用同一套页面脚本，这里只是把 Playwright 的 evaluate 递过去 */
  const evaluateOn =
    (target: Page): Evaluate =>
    (script) =>
      target.evaluate(script);

  const runAction = async (target: Page, act: ResolvedAct): Promise<string> => {
    const timeout = BROWSER_ACTION_TIMEOUT_MS;
    // 需要 ref 的动作已由 resolveAct 保证有 ref；这里再兜一次是为了类型收窄，防御性失败也不亏
    const requireLocator = (): Locator => {
      if (!act.ref) {
        throw browserError("ref_not_found", `${act.action} 需要 ref`, {
          hint: "先 browser_snapshot，把元素的 @e 编号传给 ref",
        });
      }
      return target.locator(`[${BROWSER_REF_ATTRIBUTE}="${act.ref}"]`);
    };

    switch (act.action) {
      case "click":
        await requireLocator().click({ timeout });
        return `已点击 @${act.ref}`;
      case "fill":
        await requireLocator().fill(act.text, { timeout });
        return `已在 @${act.ref} 填入 ${act.text.length} 个字符`;
      case "type":
        await requireLocator().pressSequentially(act.text, { timeout });
        return `已在 @${act.ref} 逐字输入 ${act.text.length} 个字符`;
      case "press": {
        if (act.ref) await requireLocator().press(act.key, { timeout });
        else await target.keyboard.press(act.key);
        return `已按键 ${act.key}${act.ref ? `（@${act.ref}）` : ""}`;
      }
      case "select":
        await requireLocator().selectOption(act.text, { timeout });
        return `已在 @${act.ref} 选择「${act.text}」`;
      case "eval": {
        try {
          const value = await evaluateOn(target)(evalScript(act.text));
          return `表达式结果：${formatEvalResult(value)}`;
        } catch (error) {
          throw toEvalError(error);
        }
      }
      default: {
        if (act.ref) {
          await requireLocator().scrollIntoViewIfNeeded({ timeout });
          return `已滚动到 @${act.ref}`;
        }
        const { dx, dy } = scrollDelta(act.direction, act.amount);
        await target.mouse.wheel(dx, dy);
        return `已滚动 ${dx === 0 ? `${dy}px` : `${dx}px`}`;
      }
    }
  };

  return {
    profile: input.profile,
    mode: input.mode,

    async open({ url }) {
      const target = await ensurePage();
      try {
        await target.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
        });
      } catch (error) {
        throw toBrowserError(error, `打开 ${url}`);
      }
      entries = [];
      return { url: target.url(), title: await titleOf(target) };
    },

    async snapshot({ diff = false, compact = false }) {
      const target = requirePage();
      // 换了文档（真导航）才作废旧表与 diff 基准；同文档的 pushState 不算
      const origin = await readDocumentOrigin(evaluateOn(target));
      const previous = origin === documentOrigin ? entries : [];
      const outcome = await captureSnapshot(evaluateOn(target), previous, { diff, compact });
      entries = outcome.entries;
      documentOrigin = origin;

      return {
        text: outcome.text,
        truncated: outcome.truncated,
        count: outcome.count,
        url: target.url(),
        title: await titleOf(target),
      };
    },

    async act(actInput) {
      const target = requirePage();
      const act = resolveAct(actInput);
      if (act.ref) assertRefInSnapshot(entries, act.ref);
      if (act.ref) await assertRefActionable(evaluateOn(target), act.ref);
      const before = { url: target.url(), origin: await readDocumentOrigin(evaluateOn(target)) };
      let summary: string;
      try {
        summary = await runAction(target, act);
      } catch (error) {
        throw toBrowserError(error, `${act.action} 动作`);
      }
      const url = target.url();
      return { summary, url, navigated: await documentChanged(evaluateOn(target), before, url) };
    },

    async screenshot({ fullPage = false, ref }) {
      const target = requirePage();
      const normalized = normalizeRef(ref);
      try {
        const buffer = normalized
          ? await target.locator(`[${BROWSER_REF_ATTRIBUTE}="${normalized}"]`).screenshot({
              timeout: BROWSER_ACTION_TIMEOUT_MS,
            })
          : await target.screenshot({
              fullPage,
              type: "jpeg",
              quality: BROWSER_SCREENSHOT_QUALITY,
              timeout: BROWSER_ACTION_TIMEOUT_MS,
            });
        return { data: buffer.toString("base64"), mimeType: "image/jpeg", url: target.url() };
      } catch (error) {
        // 截不到就明确说「先快照确认 ref」，否则模型会以为截图功能坏了
        throw toBrowserError(error, normalized ? `截取 @${normalized}` : "整页截图");
      }
    },

    async close() {
      const target = page;
      const ctx = context;
      const instance = browser;
      page = null;
      context = null;
      browser = null;
      entries = [];
      if (target) await target.close().catch(noop);
      // 持久化 profile：context 是入口，关它才会把这次会话写回磁盘并退出进程
      if (ctx && input.userDataDir) await ctx.close().catch(noop);
      // connectOverCDP 得到的实例，close() 只断开连接、不清掉用户的浏览器（源方案 §8 坑 1）
      if (instance) await instance.close().catch(noop);
    },

    currentUrl: () => page?.url() ?? null,

    isOpen: () => page !== null,
    isBusy: () => activeCalls > 0,
    beginUse: () => {
      activeCalls += 1;
      lastUsedAt = Date.now();
    },
    endUse: () => {
      activeCalls = Math.max(0, activeCalls - 1);
      lastUsedAt = Date.now();
    },
    idleMs: (now = Date.now()) => now - lastUsedAt,
  };
};
