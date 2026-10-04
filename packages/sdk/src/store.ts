/**
 * 极简 vanilla store：SDK 各状态层的公共原语。
 *
 * 只在引用变化时替换快照，`getState` 返回已存引用，因此订阅方可以直接对接
 * React 的 `useSyncExternalStore`（其要求快照可缓存），无需选择器记忆化。
 */
export type Store<T> = {
  /** 读取当前快照；未发生变更时保持同一引用 */
  getState: () => T;
  /** 替换快照；值相同（Object.is）时不动、不通知 */
  setState: (next: T | ((prev: T) => T)) => void;
  /** 订阅变更，返回退订函数 */
  subscribe: (listener: () => void) => () => void;
};

export const createStore = <T>(initial: T): Store<T> => {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
