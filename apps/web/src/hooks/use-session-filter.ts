/** 会话搜索：按标题、首条消息或 id 过滤 */
import { useMemo } from "react";

import { sessionTitle } from "@/lib/session";
import type { SessionSummary } from "@/lib/types";

export function useSessionFilter(sessions: SessionSummary[], query: string): SessionSummary[] {
  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (session) =>
        sessionTitle(session).toLowerCase().includes(needle) ||
        session.preview.toLowerCase().includes(needle) ||
        session.id.toLowerCase().includes(needle),
    );
  }, [query, sessions]);
}
