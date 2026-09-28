/** 会话列表：服务端数据与本地草稿会话的合并、刷新与乐观更新 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, describeError } from "@/lib/api";
import type { SessionSummary } from "@/lib/types";

export type SessionListController = {
  sessions: SessionSummary[];
  loading: boolean;
  refresh: (query?: string) => Promise<void>;
  /** 乐观更新某条会话；调用方在接口失败时 refresh 兜底 */
  patch: (sessionId: string, patch: Partial<SessionSummary>) => void;
  /** 登记一条尚未落盘的草稿会话 */
  addDraft: (session: SessionSummary) => void;
  drop: (sessionId: string) => void;
};

export function useSessionList(): SessionListController {
  const [server, setServer] = useState<SessionSummary[]>([]);
  const [local, setLocal] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (query?: string) => {
    setLoading(true);
    try {
      const data = await api.sessions.list({ q: query, limit: 200 });
      const ids = new Set(data.sessions.map((item) => item.id));
      setServer(data.sessions);
      // 已落盘的草稿会话交给服务端数据
      setLocal((prev) => prev.filter((item) => !ids.has(item.id)));
    } catch (error) {
      toast.error(`会话列表加载失败：${describeError(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sessions = useMemo(() => {
    const ids = new Set(server.map((item) => item.id));
    return [...server, ...local.filter((item) => !ids.has(item.id))].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [server, local]);

  const patch = useCallback((sessionId: string, next: Partial<SessionSummary>) => {
    const update = (list: SessionSummary[]) =>
      list.map((item) => (item.id === sessionId ? { ...item, ...next } : item));
    setServer(update);
    setLocal(update);
  }, []);

  const addDraft = useCallback((session: SessionSummary) => {
    setLocal((prev) => [session, ...prev]);
  }, []);

  const drop = useCallback((sessionId: string) => {
    setServer((prev) => prev.filter((item) => item.id !== sessionId));
    setLocal((prev) => prev.filter((item) => item.id !== sessionId));
  }, []);

  return { sessions, loading, refresh, patch, addDraft, drop };
}
