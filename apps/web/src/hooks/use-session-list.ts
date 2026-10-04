/** 会话列表：服务端数据与本地草稿会话的合并、刷新与乐观更新；子会话按父级懒加载 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  /** 已加载的子会话，按父会话 id 索引 */
  childrenByParent: Record<string, SessionSummary[]>;
  /** 正在拉取子会话的父会话 id */
  childrenLoading: Record<string, boolean>;
  /** 加载（或刷新）某个父会话的子会话；重复调用即重取 */
  loadChildren: (parentId: string) => Promise<void>;
};

export function useSessionList(): SessionListController {
  const { t } = useTranslation();
  const [server, setServer] = useState<SessionSummary[]>([]);
  const [local, setLocal] = useState<SessionSummary[]>([]);
  const [childrenByParent, setChildrenByParent] = useState<Record<string, SessionSummary[]>>({});
  const [childrenLoading, setChildrenLoading] = useState<Record<string, boolean>>({});
  // 初始即为 true：挂载后立刻 refresh，等待期间别让「URL 里的会话不存在」的判定提前生效
  const [loading, setLoading] = useState(true);
  /** 已展开过的父会话；根列表刷新时顺带刷新它们的子会话 */
  const loadedParentsRef = useRef<Set<string>>(new Set());

  const fetchChildren = useCallback(async (parentId: string): Promise<SessionSummary[]> => {
    const data = await api.sessions.list({ parentSessionId: parentId, limit: 200 });
    return data.sessions;
  }, []);

  const loadChildren = useCallback(
    async (parentId: string) => {
      loadedParentsRef.current.add(parentId);
      setChildrenLoading((prev) => ({ ...prev, [parentId]: true }));
      try {
        const list = await fetchChildren(parentId);
        setChildrenByParent((prev) => ({ ...prev, [parentId]: list }));
      } catch (error) {
        toast.error(
          t("失败提示.模板", { label: t("子会话加载失败"), reason: describeError(error) }),
        );
      } finally {
        setChildrenLoading((prev) => ({ ...prev, [parentId]: false }));
      }
    },
    [fetchChildren, t],
  );

  const refresh = useCallback(
    async (query?: string) => {
      setLoading(true);
      try {
        const data = await api.sessions.list({ q: query, limit: 200 });
        const ids = new Set(data.sessions.map((item) => item.id));
        setServer(data.sessions);
        // 已落盘的草稿会话交给服务端数据
        setLocal((prev) => prev.filter((item) => !ids.has(item.id)));

        // 已展开的父会话随根列表一起刷新：一轮委派结束后新子会话据此出现。
        // 单个父级拉取失败不影响根列表，沿用上一次的子会话缓存
        const parents = [...loadedParentsRef.current];
        const refreshed = await Promise.all(
          parents.map(async (parentId) => {
            try {
              return [parentId, await fetchChildren(parentId)] as const;
            } catch {
              return null;
            }
          }),
        );
        setChildrenByParent((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const entry of refreshed) {
            if (!entry) continue;
            next[entry[0]] = entry[1];
            changed = true;
          }
          return changed ? next : prev;
        });
      } catch (error) {
        toast.error(
          t("失败提示.模板", {
            label: t("会话列表加载失败"),
            reason: describeError(error),
          }),
        );
      } finally {
        setLoading(false);
      }
    },
    [fetchChildren, t],
  );

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
    // 子会话也可能被重命名 / 改状态，缓存里的同一行要一起更新
    setChildrenByParent((prev) => {
      let changed = false;
      const out: Record<string, SessionSummary[]> = {};
      for (const [parentId, list] of Object.entries(prev)) {
        if (list.some((item) => item.id === sessionId)) {
          out[parentId] = update(list);
          changed = true;
        } else {
          out[parentId] = list;
        }
      }
      return changed ? out : prev;
    });
  }, []);

  const addDraft = useCallback((session: SessionSummary) => {
    setLocal((prev) => [session, ...prev]);
  }, []);

  const drop = useCallback((sessionId: string) => {
    setServer((prev) => prev.filter((item) => item.id !== sessionId));
    setLocal((prev) => prev.filter((item) => item.id !== sessionId));
    // 归档父会话会级联归档子会话，缓存的整棵列表一并丢弃
    loadedParentsRef.current.delete(sessionId);
    setChildrenByParent((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  return {
    sessions,
    loading,
    refresh,
    patch,
    addDraft,
    drop,
    childrenByParent,
    childrenLoading,
    loadChildren,
  };
}
