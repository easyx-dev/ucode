/** 订阅 SDK store 的通用 React 绑定：基于原生 useSyncExternalStore */
import type { Store } from "@ucode/sdk";
import { useSyncExternalStore } from "react";

/** 只读订阅面：SDK 各域 store 暴露 getState/subscribe，动作方法另有其名 */
export type Observable<T> = Pick<Store<T>, "getState" | "subscribe">;

export function useStore<T>(store: Observable<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
