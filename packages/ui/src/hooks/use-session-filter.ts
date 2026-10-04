/** 会话搜索：按标题、首条消息或 id 过滤 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { sessionTitle } from "../lib/session";
import type { SessionSummary } from "../lib/types";

export function useSessionFilter(sessions: SessionSummary[], query: string): SessionSummary[] {
  const { t } = useTranslation();

  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (session) =>
        sessionTitle(session, t("新会话")).toLowerCase().includes(needle) ||
        session.preview.toLowerCase().includes(needle) ||
        session.id.toLowerCase().includes(needle),
    );
  }, [query, sessions, t]);
}
