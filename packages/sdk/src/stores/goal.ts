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
  /** 只改预算；`tokenBudget` 传 null 即取消上限 */
  setBudget: (sessionId: string, tokenBudget: number | null) => Promise<void>;
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

  /** 从会话详情补一次目标；取不到时保留上一次的值 */
  const hydrate = async (sessionId: string): Promise<void> => {
    try {
      const { goal } = await deps.apis.sessions.info(sessionId);
      write(sessionId, goal);
    } catch {
      // 目标只是展示，取不到不打扰
    }
  };

  const apply = async (
    sessionId: string,
    action: () => Promise<{ goal: GoalView | null }>,
  ): Promise<void> => {
    try {
      const { goal } = await action();
      // 成功即清：ErrorToaster 靠对象身份判「新错误」，旧 error 留着会在它重挂载时再弹一次
      store.setState((prev) => ({
        ...prev,
        bySession: { ...prev.bySession, [sessionId]: goal },
        error: null,
      }));
    } catch (error) {
      store.setState((prev) => ({ ...prev, error: asApiError(error) }));
    }
  };

  deps.events.onEvent((frame) => {
    if (frame.type !== "goal_update") return;
    write(frame.sessionId, (frame.data as GoalView | null) ?? null);
  });

  // 重连补快照：目标状态的真相在服务端（连续跑与暂停都可能由服务端自己发起），
  // 断流期间错过的 `goal_update` 不回放，只重取已加载过的会话
  let connectedOnce = false;
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    for (const sessionId of Object.keys(store.getState().bySession)) void hydrate(sessionId);
  });

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    get: (sessionId) => (sessionId ? (store.getState().bySession[sessionId] ?? null) : null),
    hydrate,
    set: (sessionId, input) => apply(sessionId, () => deps.apis.goals.set({ sessionId, ...input })),
    setBudget: (sessionId, tokenBudget) =>
      apply(sessionId, () => deps.apis.goals.budget({ sessionId, tokenBudget })),
    pause: (sessionId) => apply(sessionId, () => deps.apis.goals.pause(sessionId)),
    resume: (sessionId) => apply(sessionId, () => deps.apis.goals.resume(sessionId)),
    clear: (sessionId) => apply(sessionId, () => deps.apis.goals.clear(sessionId)),
    status: (sessionId) => apply(sessionId, () => deps.apis.goals.status(sessionId)),
  };
};
