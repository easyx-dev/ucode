/** 会话消息流：订阅 client 的 messages store（快照 / 接续 / 归并都在 SDK 内） */
import type { SessionStreamState } from "@ucode/sdk";
import { useEffect, useMemo } from "react";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export function useSessionStream(sessionId: string | null): SessionStreamState {
  const client = useClient();
  const store = useMemo(() => client.messages.get(sessionId), [client, sessionId]);
  const state = useStore(store);

  useEffect(() => {
    client.messages.activate(sessionId);
  }, [client, sessionId]);

  return state;
}
