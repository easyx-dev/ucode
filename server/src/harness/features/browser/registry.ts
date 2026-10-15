/**
 * profile → 实例的注册表：引用计数、空闲回收、进程退出与会话回收时的释放。
 *
 * 实例按 **profile 名**持有，不按会话：同一个 profile 被多个会话引用时只开一份浏览器进程，
 * 代价是这些会话之间不再有 cookie 隔离——这是用户显式共用一份 profile 的结果（见方案第 5.2 节）。
 */
import { existsSync } from "node:fs";

import {
  BROWSER_IDLE_TTL_MS,
  BROWSER_MAX_PROFILES,
  BROWSER_MAX_SESSIONS,
} from "../../../constants/browser";
import { browserError } from "./errors";
import type { BrowserHooks } from "./hooks";
import { ensureProfileDir, isValidProfileName, listProfiles, profilePath } from "./profiles";
import { type BrowserMode, type BrowserSession, createBrowserSession } from "./session";

export type BrowserInstanceStats = {
  profile: string;
  mode: BrowserMode;
  /** 引用该 profile 的会话 id */
  holders: string[];
  /** 是否已经有页面（还没打开的实例不占进程） */
  open: boolean;
  /** 持久化数据目录；临时实例为 null */
  userDataDir: string | null;
  idleMs: number;
};

export type BrowserRegistry = BrowserHooks & {
  /** 排障与测试用 */
  stats: () => BrowserInstanceStats[];
  /** 该 profile 的实例（没有则 null） */
  session: (profile: string) => BrowserSession | null;
  /** 本会话正用着哪个 profile 的实例；没有就用 null（`current` 的非抛版本） */
  holderOf: (sessionId: string) => string | null;
  /** 该 profile 是否正被某个实例持有（设置页删除前的保护） */
  isInUse: (profile: string) => boolean;
  disposeAll: () => void;
};

export type BrowserRegistryOptions = {
  idleTtlMs?: number;
  maxInstances?: number;
  /** `$APP_HOME`；测试可注入，生产走 env */
  appHome?: string;
  now?: () => number;
};

type Entry = { session: BrowserSession; holders: Set<string>; userDataDir: string | null };

/** 目录是否已经存在：用来判断这次是「新建 profile」还是「复用已有的」 */
const profileExists = (dir: string): boolean => existsSync(dir);

export const createBrowserRegistry = (options: BrowserRegistryOptions = {}): BrowserRegistry => {
  const idleTtlMs = options.idleTtlMs ?? BROWSER_IDLE_TTL_MS;
  const maxInstances = options.maxInstances ?? BROWSER_MAX_SESSIONS;
  const now = options.now ?? (() => Date.now());
  /** 已经落盘的持久化 profile 数（不含本次要新建的） */
  const persistentProfileCount = (): number => listProfiles(options.appHome).length;
  /** 解析本次取用要用哪份数据目录：持久化要建目录、占名额，且不能与已打开的实例不一致 */
  const resolveUserDataDir = (input: { profile: string; persist?: boolean }): string | null => {
    if (input.persist !== true) return null;
    if (!isValidProfileName(input.profile)) {
      throw browserError("browser_profile_invalid", `profile 名不合法：${input.profile}`, {
        hint: "只能用小写字母或数字开头、含小写字母 / 数字 / `.` `_` `-` 的单段名字，长度不超过 64",
      });
    }
    const dir = profilePath(input.profile, options.appHome);
    const exists = entries.has(input.profile) || profileExists(dir);
    if (!exists && persistentProfileCount() >= BROWSER_MAX_PROFILES) {
      throw browserError("browser_limit", `持久化 profile 已达上限（${BROWSER_MAX_PROFILES}）`, {
        hint: "在设置里删掉不再用的 profile，或改用临时 instance（不传 profile）",
      });
    }
    return ensureProfileDir(input.profile, options.appHome);
  };

  const entries = new Map<string, Entry>();
  /** 会话 → 它正在用的 profile：后续工具调用据此找回实例 */
  const usedBySession = new Map<string, string>();
  let sweepTimer: NodeJS.Timeout | null = null;

  const stopTimer = (): void => {
    if (!sweepTimer) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
  };

  const closeEntry = async (profile: string): Promise<void> => {
    const entry = entries.get(profile);
    if (!entry) return;
    entries.delete(profile);
    for (const sessionId of entry.holders) {
      if (usedBySession.get(sessionId) === profile) usedBySession.delete(sessionId);
    }
    await entry.session.close().catch(() => undefined);
  };

  /** 空闲回收：没有引用者、没在调用中、且超过 TTL 的实例关掉 */
  const sweep = (): void => {
    const stamp = now();
    for (const [profile, entry] of entries) {
      if (entry.holders.size > 0 || entry.session.isBusy()) continue;
      if (entry.session.idleMs(stamp) < idleTtlMs) continue;
      void closeEntry(profile);
    }
    if (entries.size === 0) stopTimer();
  };

  const startTimer = (): void => {
    if (sweepTimer) return;
    // 四分之一 TTL 扫一次：既不会让空闲实例多留一整轮，也不至于频繁唤醒
    sweepTimer = setInterval(sweep, Math.max(1_000, Math.floor(idleTtlMs / 4)));
    sweepTimer.unref();
  };

  return {
    acquire(input) {
      const userDataDir = resolveUserDataDir(input);
      const existing = entries.get(input.profile);
      if (existing) {
        // 同一份 profile 不能被两种数据目录同时打开：临时实例与持久化实例的 cookie 面完全不同
        if (existing.userDataDir !== userDataDir) {
          throw browserError(
            "browser_profile_in_use",
            `profile 「${input.profile}」已用另一种数据目录打开`,
            {
              hint: "先 browser_close，或换一个 profile 名",
            },
          );
        }
        existing.holders.add(input.sessionId);
        usedBySession.set(input.sessionId, input.profile);
        startTimer();
        return existing.session;
      }

      if (entries.size >= maxInstances) {
        throw browserError("browser_limit", `同时运行的浏览器实例已达上限（${maxInstances}）`, {
          hint: "先用 browser_close 关掉不用的实例，或等空闲回收",
        });
      }

      const session = createBrowserSession({
        profile: input.profile,
        mode: input.mode,
        ...(input.executablePath ? { executablePath: input.executablePath } : {}),
        ...(input.endpoint ? { endpoint: input.endpoint } : {}),
        ...(input.headless === undefined ? {} : { headless: input.headless }),
        ...(userDataDir ? { userDataDir } : {}),
      });
      entries.set(input.profile, { session, holders: new Set([input.sessionId]), userDataDir });
      usedBySession.set(input.sessionId, input.profile);
      startTimer();
      return session;
    },

    current(sessionId) {
      const profile = usedBySession.get(sessionId);
      const entry = profile ? entries.get(profile) : undefined;
      if (!entry) {
        throw browserError("browser_not_open", "本会话还没有打开过页面", {
          hint: "先调用 browser_open；若要换一个 profile，在 browser_open 里传 profile",
        });
      }
      return entry.session;
    },

    release(sessionId, releaseOptions = {}) {
      const profile = usedBySession.get(sessionId);
      const entry = profile ? entries.get(profile) : undefined;
      if (!entry || !profile) return { closed: false, remainingHolders: 0 };

      entry.holders.delete(sessionId);
      if (usedBySession.get(sessionId) === profile) usedBySession.delete(sessionId);

      if (entry.holders.size === 0 && releaseOptions.closeWhenUnused === true) {
        void closeEntry(profile);
        return { closed: true, remainingHolders: 0 };
      }
      return { closed: false, remainingHolders: entry.holders.size };
    },

    stats() {
      const stamp = now();
      return [...entries].map(([profile, entry]) => ({
        profile,
        mode: entry.session.mode,
        holders: [...entry.holders],
        open: entry.session.isOpen(),
        userDataDir: entry.userDataDir,
        idleMs: entry.session.idleMs(stamp),
      }));
    },

    /** 该 profile 的实例（没有则 null）：服务门面按 profile 定位当前实例 */
    session(profile) {
      return entries.get(profile)?.session ?? null;
    },

    /** 本会话正用着哪个 profile 的实例；没有就用 null（`current` 的非抛版本） */
    holderOf: (sessionId) => usedBySession.get(sessionId) ?? null,

    /** 该 profile 是否正被某个实例持有（设置页删除前的保护） */
    isInUse(profile) {
      return (entries.get(profile)?.holders.size ?? 0) > 0;
    },

    disposeAll() {
      stopTimer();
      // 走 closeEntry：引用清理只有这一条路，别在这里另写一遍
      for (const profile of [...entries.keys()]) void closeEntry(profile);
      usedBySession.clear();
    },
  };
};
