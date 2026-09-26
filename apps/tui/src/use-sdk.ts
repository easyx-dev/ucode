import type { AgentSdk, SdkState } from "@ucode/sdk";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/** 把 sdk 的状态订阅成 React 可用的快照（外部 store 的标准接法）。 */
export function useSdkState(sdk: AgentSdk): SdkState {
  const subscribe = useCallback((listener: () => void) => sdk.subscribe(listener), [sdk]);
  const getSnapshot = useCallback(() => sdk.state, [sdk]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 当前会话的展示行（记录 + 非权威的流式尾巴）。 */
export function useTranscript(
  sdk: AgentSdk,
  sessionId: string | null,
): ReturnType<AgentSdk["displayMessages"]> {
  const state = useSdkState(sdk);
  return useMemo(
    () => (sessionId === null ? [] : sdk.displayMessages(sessionId)),
    [sdk, sessionId, state],
  );
}
