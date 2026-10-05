/**
 * 当前会话的累计 token 用量：进入会话时补一次，之后由 `session_updated` 事件在每轮落定时更新。
 */
import type { UsageTotals } from "@ucode/contracts";
import { useEffect } from "react";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export function useSessionUsage(sessionId: string | null): UsageTotals | null {
  const client = useClient();
  const state = useStore(client.usage);

  useEffect(() => {
    if (sessionId) void client.usage.loadSession(sessionId);
  }, [client, sessionId]);

  return sessionId ? (state.bySession[sessionId] ?? null) : null;
}
