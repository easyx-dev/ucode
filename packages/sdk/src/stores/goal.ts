/**
 * 会话目标：按 sessionId 缓存目标视图。
 *
 * 切换会话时取一次（`sessions/info`），之后由 `goal_update` 事件增量同步。
 */
import type { GoalView } from "@ucode/contracts";

import type { Apis } from "../apis";
import { type ApiError, asApiError } from "../error";
import type { EventStream } from "../events";
import { createStore, type Store } from "../store";

export type GoalInput = {
  objective: string;
  tokenBudget?: number;
};

export type GoalState = {
  bySession: Record<string, GoalView | null>;
  error: ApiError | null;
};

export type GoalStore = {
  getState: Store<GoalState>["getState"];
  subscribe: Store<GoalState>["subscribe"];
  /** 取某会话的目标；sessionId 为 null 时返回 null */
  get: (sessionId: string | null) => GoalView | null;
  /** 从会话详情补一次目标（切换会话时用） */
  hydrate: (sessionId: string) => Promise<void>;
  set: (sessionId: string, input: GoalInput) => Promise<void>;
  pause: (sessionId: string) => Promise<void>;
  resume: (sessionId: string) => Promise<void>;
  clear: (sessionId: string) => Promise<void>;
  status: (sessionId: string) => Promise<void>;
};

export const createGoalStore = (deps: { apis: Apis; events: EventStream }): GoalStore => {
  const store = createStore<GoalState>({ bySession: {}, error: null });

  const write = (sessionId: string, goal: GoalView | null): void => {
    store.setState((prev) => ({ ...prev, bySession: { ...prev.bySession, [sessionId]: goal } }));
  };

  const apply = async (
    sessionId: string,
    action: () => Promise<{ goal: GoalView | null }>,
  ): Promise<void> => {
    try {
      const { goal } = await action();
      write(sessionId, goal);
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  deps.events.onEvent((frame) => {
    if (frame.type !== "goal_update") return;
    write(frame.sessionId, (frame.data as GoalView | null) ?? null);
  });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    get: (sessionId) => (sessionId ? (store.getState().bySession[sessionId] ?? null) : null),
    async hydrate(sessionId) {
      try {
        const { goal } = await deps.apis.sessions.info(sessionId);
        write(sessionId, goal);
      } catch {
        // 目标只是展示，取不到不打扰
      }
    },
    set: (sessionId, input) => apply(sessionId, () => deps.apis.goals.set({ sessionId, ...input })),
    pause: (sessionId) => apply(sessionId, () => deps.apis.goals.pause(sessionId)),
    resume: (sessionId) => apply(sessionId, () => deps.apis.goals.resume(sessionId)),
    clear: (sessionId) => apply(sessionId, () => deps.apis.goals.clear(sessionId)),
    status: (sessionId) => apply(sessionId, () => deps.apis.goals.status(sessionId)),
  };
};
