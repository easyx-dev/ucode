/** 订阅 SDK store 的通用 React 绑定：基于原生 useSyncExternalStore */
import type { Store } from "@ucode/sdk";
import { useSyncExternalStore } from "react";

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
