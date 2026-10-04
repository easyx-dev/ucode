/** 会话消息流：订阅 SDK 的会话流 store（快照 / 接续 / 归并都在 SDK 内） */
import type { SessionStreamState } from "@ucode/sdk";
import { useEffect, useMemo } from "react";

import { useStore } from "@/hooks/use-store";
import { sdk } from "@/lib/sdk";

export function useSessionStream(sessionId: string | null): SessionStreamState {
  const store = useMemo(() => sdk.sessionStream.get(sessionId), [sessionId]);
  const state = useStore(store);

  useEffect(() => {
    sdk.events.start();
    sdk.sessionStream.activate(sessionId);
  }, [sessionId]);

  return state;
}
