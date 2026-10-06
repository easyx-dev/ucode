/**
 * 当前会话的展示用量：累计 token 用量与当前上下文占用。
 * 进入会话时经一次会话详情补上，之后由 `session_updated` 事件在每轮落定时更新。
 */
import type { ContextUsage, UsageTotals } from "@ucode/contracts";
import { useEffect } from "react";

import { useClient } from "../provider";
import { useStore } from "./use-store";

export function useSessionUsage(sessionId: string | null): {
  usage: UsageTotals | null;
  context: ContextUsage | null;
} {
  const client = useClient();
  const state = useStore(client.usage);

  useEffect(() => {
    if (sessionId) void client.usage.loadSession(sessionId);
  }, [client, sessionId]);

  return {
    usage: sessionId ? (state.bySession[sessionId] ?? null) : null,
    context: sessionId ? (state.contextBySession[sessionId] ?? null) : null,
  };
}
