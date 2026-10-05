/**
 * 使用统计：全局汇总按需查询；单会话累计用量由 `session_updated` 事件随摘要下发，
 * 首次进入会话时经 `sessions/info` 补齐一次。
 */
import type { StatsSummaryResponse, UsageTotals } from "@ucode/contracts";

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
};

export type UsageStore = {
  getState: Store<UsageState>["getState"];
  subscribe: Store<UsageState>["subscribe"];
  /** 全局汇总；`days` 缺省为全部时间 */
  loadStats: (days?: number) => Promise<void>;
  /** 取某会话累计用量；未加载过时返回 null */
  getSession: (sessionId: string | null) => UsageTotals | null;
  /** 经 `sessions/info` 补一次会话用量 */
  loadSession: (sessionId: string) => Promise<void>;
};

export const createUsageStore = (deps: { apis: Apis; events: EventStream }): UsageStore => {
  const store = createStore<UsageState>({
    stats: null,
    statsLoading: false,
    error: null,
    bySession: {},
  });

  deps.events.onEvent((frame) => {
    if (frame.type !== "session_updated") return;
    const { usage } = frame.data as { usage?: UsageTotals };
    if (!usage) return;
    store.setState((prev) => ({
      ...prev,
      bySession: { ...prev.bySession, [frame.sessionId]: usage },
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
    async loadSession(sessionId) {
      try {
        const { usage } = await deps.apis.sessions.info(sessionId);
        store.setState((prev) => ({
          ...prev,
          bySession: { ...prev.bySession, [sessionId]: usage },
        }));
      } catch {
        // 用量只是展示，取不到沿用上一次
      }
    },
  };
};
