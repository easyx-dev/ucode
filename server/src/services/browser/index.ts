/**
 * 浏览器能力的进程级门面：实例注册表 + profile 数据面的列举与清理。
 *
 * 浏览器进程不归会话池管（也不随会话回收立即关），所以清理放在 `services/index` 的 `close()` 里，
 * 与会话回收分开（照终端的先例）。profile 目录落在 `$APP_HOME/app/browser/profiles/<name>`（0700）。
 *
 * 画面不从这里出去：桌面端用内置 webview 承载浏览器，用户在那个 webview 里直接看着 agent 操作
 * （见 docs/browser.md）；服务端自管的实例只提供工具能力。
 */

import type {
  BrowserDeleteInput,
  BrowserDeleteResponse,
  BrowserListResponse,
} from "@ucode/contracts";
import { BROWSER_MAX_PROFILES, BROWSER_PROFILE_MAX_BYTES } from "../../constants/browser";
import { createDesktopSession } from "../../harness/features/browser/desktop/session";
import { browserError } from "../../harness/features/browser/errors";
import type { BrowserHooks } from "../../harness/features/browser/hooks";
import {
  deleteProfiles,
  isValidProfileName,
  listProfiles,
  profilesRoot,
} from "../../harness/features/browser/profiles";
import {
  type BrowserInstanceStats,
  type BrowserRegistry,
  createBrowserRegistry,
} from "../../harness/features/browser/registry";
import type { BrowserSession } from "../../harness/features/browser/session";
import { createDesktopBrowsers, type DesktopBrowsers } from "./desktop";

export type BrowserService = {
  /** 工具那一侧的动作面：受管实例与桌面端面板都在它后面 */
  hooks: BrowserHooks;
  /** 列出磁盘上的 profile（含使用中标记与占用） */
  list: () => BrowserListResponse;
  /** 删除 profile；使用中的跳过并说明原因 */
  delete: (input: BrowserDeleteInput) => BrowserDeleteResponse;
  /** 桌面端浏览器通道：有哪些标签、当前在看哪一个（见 docs/browser.md） */
  desktop: DesktopBrowsers;
  /** 排障 / 测试用：当前实例与引用者 */
  stats: () => BrowserInstanceStats[];
  disposeAll: () => void;
};

export const createBrowserService = (options: { appHome?: string } = {}): BrowserService => {
  const registry: BrowserRegistry = createBrowserRegistry({ appHome: options.appHome });
  const desktop = createDesktopBrowsers();
  /** 桌面端那个页面：按 pi 会话缓存（编号表要跨工具调用活着），绑定的标签或 guest 变了就重建 */
  const desktopSessions = new Map<
    string,
    { tabId: string; webContentsId: number; session: BrowserSession }
  >();

  /** 当前激活的标签能不能驱动（guest 还没挂上时 webContentsId 还是 null） */
  const desktopTab = () => {
    const tab = desktop.activeTab();
    return tab && tab.webContentsId !== null ? { ...tab, webContentsId: tab.webContentsId } : null;
  };

  /** 取（或建）桌面端那个页面的会话；桌面端没开标签时返回 null */
  const openDesktopSession = (sessionId: string): BrowserSession | null => {
    const tab = desktopTab();
    if (!tab) return null;
    const cached = desktopSessions.get(sessionId);
    if (cached?.tabId === tab.id && cached.webContentsId === tab.webContentsId)
      return cached.session;
    if (cached) dropDesktopSession(sessionId);

    const webContentsId = tab.webContentsId;
    const session = createDesktopSession({
      transport: {
        // sendCommand 返回 unknown（CDP 的返回值形状由调用方声明），这里按传输契约里那个 T 收口
        send: <T>(method: string, params?: Record<string, unknown>) =>
          desktop.sendCommand(webContentsId, method, params) as Promise<T>,
        // 事件按 webContents 过滤：会话只关心自己那一个页面的导航
        on: (listener) =>
          desktop.subscribeCdp((event) => {
            if (event.webContentsId === webContentsId) listener(event);
          }),
      },
      url: tab.url,
      title: tab.title,
    });
    desktopSessions.set(sessionId, { tabId: tab.id, webContentsId, session });
    return session;
  };

  /** 丢掉缓存里那个桌面端会话（标签关了、换了、或干脆是断开）；返回丢没丢过 */
  const dropDesktopSession = (sessionId: string): boolean => {
    const cached = desktopSessions.get(sessionId);
    if (!cached) return false;
    desktopSessions.delete(sessionId);
    void cached.session.close();
    return true;
  };

  /**
   * 工具那一侧的动作面：受管实例与桌面端面板都从这里进（见 `BrowserHooks`）。
   *
   * 路由规则一句话：**没显式要受管实例、而桌面端开着浏览器标签时，驱动桌面端那一个**——用户在看着它做事；
   * 其余情况都还是受管实例（老行为不变）。已经在用受管实例的会话不会被中途换掉。
   */
  const hooks: BrowserHooks = {
    acquire(input) {
      if (registry.holderOf(input.sessionId) !== null) return registry.acquire(input);
      // 显式要受管实例时，把桌面端那个会话丢掉：一个会话同时握着两种，释放时必然漏掉一侧的引用
      if (input.managedRequested === true) {
        dropDesktopSession(input.sessionId);
        return registry.acquire(input);
      }
      return openDesktopSession(input.sessionId) ?? registry.acquire(input);
    },

    current(sessionId) {
      // 受管实例优先：它出现过，就说明这个会话要的是它（acquire 那侧也保证了两者不会共存）
      if (registry.holderOf(sessionId) !== null) return registry.current(sessionId);
      const cached = desktopSessions.get(sessionId);
      if (cached) {
        const tab = desktopTab();
        // 标签与 guest 都要对得上：guest 崩溃重建会换一个 webContentsId，复用旧会话就是拿死句柄发命令
        if (tab?.id === cached.tabId && tab.webContentsId === cached.webContentsId) {
          return cached.session;
        }
        // 标签关了、换了、或 guest 重建了：编号表跟着作废，下面按新状态重新决定
        dropDesktopSession(sessionId);
      }
      const desktopSession = openDesktopSession(sessionId);
      if (desktopSession) return desktopSession;
      if (desktop.state().connected) {
        throw browserError("browser_not_open", "桌面端没有开着浏览器标签", {
          hint: "在桌面端工作台的「浏览器」视图里打开一个标签，或用 browser_open 打开一个地址",
        });
      }
      return registry.current(sessionId);
    },

    release(sessionId, releaseOptions) {
      // 桌面端那个页面是用户自己的标签：只断开，不关任何东西
      const dropped = dropDesktopSession(sessionId);
      // 注册表的引用必须照放：会话同时握着两种时（历史状态或配置变化），漏放会永久占住 profile
      const result = registry.release(sessionId, releaseOptions);
      return dropped ? { closed: false, remainingHolders: 0 } : result;
    },

    isManaged(sessionId) {
      // 桌面端那个会话由本文件管（不在注册表里），先把它排除：它不是受管实例，
      // 只读模式得据此把它留在阻断侧
      if (desktopSessions.has(sessionId)) return false;
      return registry.isManaged(sessionId);
    },
  };

  return {
    hooks,
    desktop,

    list() {
      return {
        profiles: listProfiles(options.appHome).map((profile) => ({
          ...profile,
          inUse: registry.isInUse(profile.name),
        })),
        root: profilesRoot(options.appHome),
        limits: { maxProfiles: BROWSER_MAX_PROFILES, maxBytes: BROWSER_PROFILE_MAX_BYTES },
      };
    },

    delete(input) {
      const deletable: string[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const raw of input.names) {
        const name = raw.trim();
        // 名字不合法在这里就挡下：往下传会让 profiles.ts 抛错、整条请求变成 500，
        // 而调用方真正需要的是「哪几个没删掉、为什么」
        if (!isValidProfileName(name)) {
          skipped.push({ name, reason: "名字不合法" });
          continue;
        }
        // 使用中不能删：删到一半会把实例正打开着的文件抽走
        if (registry.isInUse(name)) {
          skipped.push({ name, reason: "正在使用中" });
          continue;
        }
        deletable.push(name);
      }
      const result = deleteProfiles(deletable, options.appHome);
      return { deleted: result.deleted, missing: result.missing, skipped };
    },

    stats: registry.stats,
    disposeAll: () => registry.disposeAll(),
  };
};
