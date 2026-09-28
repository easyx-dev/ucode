import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";
import type { SessionSummary, ThinkingLevel } from "@/lib/types";

const describeError = (error: unknown): string =>
  error instanceof ApiRequestError ? error.message : String(error);

export function useSessions() {
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

  const create = useCallback(async (): Promise<SessionSummary | null> => {
    try {
      const session = await api.sessions.create({});
      setLocal((prev) => [session, ...prev]);
      return session;
    } catch (error) {
      toast.error(`新建会话失败：${describeError(error)}`);
      return null;
    }
  }, []);

  const rename = useCallback(
    async (sessionId: string, name: string): Promise<void> => {
      const patch = (list: SessionSummary[]) =>
        list.map((item) => (item.id === sessionId ? { ...item, name } : item));
      setServer(patch);
      setLocal(patch);
      try {
        await api.sessions.update({ sessionId, name });
      } catch (error) {
        toast.error(`重命名失败：${describeError(error)}`);
        void refresh();
      }
    },
    [refresh],
  );

  const setModel = useCallback(async (sessionId: string, model: string): Promise<void> => {
    const patch = (list: SessionSummary[]) =>
      list.map((item) => (item.id === sessionId ? { ...item, model } : item));
    setServer(patch);
    setLocal(patch);
    try {
      await api.sessions.update({ sessionId, model });
    } catch (error) {
      toast.error(`切换模型失败：${describeError(error)}`);
    }
  }, []);

  const setThinkingLevel = useCallback(
    async (sessionId: string, thinkingLevel: ThinkingLevel): Promise<void> => {
      // 乐观更新，否则下拉框会一直显示全局值
      const patch = (list: SessionSummary[]) =>
        list.map((item) => (item.id === sessionId ? { ...item, thinkingLevel } : item));
      setServer(patch);
      setLocal(patch);
      try {
        await api.sessions.update({ sessionId, thinkingLevel });
      } catch (error) {
        toast.error(`设置 thinking level 失败：${describeError(error)}`);
        void refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(async (sessionId: string): Promise<void> => {
    try {
      await api.sessions.remove(sessionId);
      setServer((prev) => prev.filter((item) => item.id !== sessionId));
      setLocal((prev) => prev.filter((item) => item.id !== sessionId));
      toast.success("会话已删除");
    } catch (error) {
      toast.error(`删除失败：${describeError(error)}`);
    }
  }, []);

  return { sessions, loading, refresh, create, rename, setModel, setThinkingLevel, remove };
}
