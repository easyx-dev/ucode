import type { AgentSdk } from "@ucode/sdk";
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import { type AgentStore, type AgentStoreState, createAgentStore } from "./store.ts";

/** 把 store 实例挂进 React 树（每个宿主创建自己的 store，因此 ui 不持有全局单例）。 */
const StoreContext = createContext<AgentStore | null>(null);

export function AgentStoreProvider({
  sdk,
  store,
  children,
}: {
  sdk?: AgentSdk;
  store?: AgentStore;
  children: ReactNode;
}): ReactNode {
  const [created] = useState<AgentStore>(() => store ?? createAgentStore(sdk as AgentSdk));
  useEffect(() => {
    // 首次挂载就把会话与模型列表拉一遍（sdk 的 state 里可能是空的）
    void created.getState().refresh();
  }, [created]);
  return createElement(StoreContext.Provider, { value: created }, children);
}

export function useAgentStore<T>(selector: (state: AgentStoreState) => T): T {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useAgentStore 必须在 AgentStoreProvider 内使用。");
  return useStore(store, selector);
}

export function useAgent(): AgentStoreState {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useAgent 必须在 AgentStoreProvider 内使用。");
  return useStore(store, (state) => state);
}

/** 会话切换时把转录滚动到底部（终端习惯：永远看最新）。 */
export function useStickToBottom(dependency: unknown): (node: HTMLDivElement | null) => void {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [dependency]);
  return (node) => {
    ref.current = node;
  };
}
