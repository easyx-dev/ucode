/** 当前选中的会话：默认选中最近一个，会话从列表消失时清空；选中项同步到 URL 便于刷新恢复 */
import { useCallback, useEffect, useState } from "react";

import type { SessionSummary } from "@/lib/types";

const SESSION_QUERY_KEY = "session";

const readSessionFromUrl = (): string | null =>
  new URLSearchParams(window.location.search).get(SESSION_QUERY_KEY);

/** 写回 URL；用户主动切换用 push 保留历史，程序化纠偏用 replace 不污染历史 */
const writeSessionToUrl = (sessionId: string | null, mode: "push" | "replace"): void => {
  const url = new URL(window.location.href);
  if (sessionId) url.searchParams.set(SESSION_QUERY_KEY, sessionId);
  else url.searchParams.delete(SESSION_QUERY_KEY);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
};

export function useActiveSession(sessions: SessionSummary[], loading: boolean) {
  const [activeId, setActiveIdState] = useState<string | null>(readSessionFromUrl);

  const setActiveId = useCallback((sessionId: string | null) => {
    setActiveIdState(sessionId);
    writeSessionToUrl(sessionId, "push");
  }, []);

  // URL 未指定会话时，列表就绪后默认选中最近一个
  useEffect(() => {
    if (activeId !== null) return;
    const first = sessions[0];
    if (!first) return;
    setActiveIdState(first.id);
    writeSessionToUrl(first.id, "replace");
  }, [activeId, sessions]);

  // 列表加载完成后，URL 指向的会话已不存在则清空
  useEffect(() => {
    if (loading || activeId === null) return;
    if (sessions.some((item) => item.id === activeId)) return;
    setActiveIdState(null);
    writeSessionToUrl(null, "replace");
  }, [activeId, loading, sessions]);

  // 浏览器前进 / 后退：URL 是选中项的事实源
  useEffect(() => {
    const onPopState = () => setActiveIdState(readSessionFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return { activeId, setActiveId };
}
