/**
 * 使用统计：全局汇总按需查询；单会话累计用量与当前上下文占用由 `session_updated` 事件随摘要下发，
 * 首次进入会话时经 `sessions/info` 补齐一次。
 */
import type { ContextUsage, StatsSummaryResponse, UsageTotals } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type UsageState = {
  stats: StatsSummaryResponse | null;
  statsLoading: boolean;
  error: ApiError | null;
  /** 按会话索引的累计用量 */
  bySession: Record<string, UsageTotals>;
  /** 按会话索引的当前上下文占用；取不到时为 null（还没回答过 / 压缩后待新一轮回复） */
  contextBySession: Record<string, ContextUsage | null>;
};

export type UsageStore = {
  getState: Store<UsageState>["getState"];
  subscribe: Store<UsageState>["subscribe"];
  /** 全局汇总；`days` 缺省为全部时间 */
  loadStats: (days?: number) => Promise<void>;
  /** 取某会话累计用量；未加载过时返回 null */
  getSession: (sessionId: string | null) => UsageTotals | null;
  /** 取某会话当前上下文占用；未加载过或取不到时返回 null */
  getContext: (sessionId: string | null) => ContextUsage | null;
  /** 经 `sessions/info` 补一次会话用量与上下文占用 */
  loadSession: (sessionId: string) => Promise<void>;
};

export const createUsageStore = (deps: { apis: Apis; events: EventStream }): UsageStore => {
  const store = createStore<UsageState>({
    stats: null,
    statsLoading: false,
    error: null,
    bySession: {},
    contextBySession: {},
  });

  deps.events.onEvent((frame) => {
    if (frame.type !== "session_updated") return;
    const { usage, contextUsage } = frame.data as {
      usage?: UsageTotals;
      contextUsage?: ContextUsage | null;
    };
    // 两者同帧下发：没有 usage 的这一帧不带占用，沿用上一次
    if (!usage) return;
    store.setState((prev) => ({
      ...prev,
      bySession: { ...prev.bySession, [frame.sessionId]: usage },
      contextBySession: { ...prev.contextBySession, [frame.sessionId]: contextUsage ?? null },
    }));
  });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    async loadStats(days) {
      store.setState((prev) => ({ ...prev, statsLoading: true }));
      try {
        const stats = await deps.apis.stats.summary(days ? { days } : {});
        store.setState((prev) => ({ ...prev, stats, error: null }));
      } catch (error) {
        store.setState((prev) => ({ ...prev, error: asApiError(error) }));
      } finally {
        store.setState((prev) => ({ ...prev, statsLoading: false }));
      }
    },
    getSession: (sessionId) => (sessionId ? (store.getState().bySession[sessionId] ?? null) : null),
    getContext: (sessionId) =>
      sessionId ? (store.getState().contextBySession[sessionId] ?? null) : null,
    async loadSession(sessionId) {
      try {
        const { usage, contextUsage } = await deps.apis.sessions.info(sessionId);
        store.setState((prev) => ({
          ...prev,
          bySession: { ...prev.bySession, [sessionId]: usage },
          contextBySession: { ...prev.contextBySession, [sessionId]: contextUsage },
        }));
      } catch {
        // 用量只是展示，取不到沿用上一次
      }
    },
  };
};
