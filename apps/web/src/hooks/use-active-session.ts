/**
 * 当前选中的会话：默认选中最近一个，会话消失时清空；选中项同步到 URL 便于刷新恢复。
 *
 * 子会话不在主列表里，所以「找不到」不能直接判为失效：先经 `sessions/info` 解析，
 * 已归档或确实不存在才清空。子会话视图据此拿到摘要与父会话 id。
 */
import { ERROR_CODES } from "@ucode/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiRequestError, api } from "@/lib/api";
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

export type ActiveSessionController = {
  activeId: string | null;
  setActiveId: (sessionId: string | null) => void;
  /** 当前会话摘要：主列表里有就直接取，子会话（不在主列表）经接口补齐 */
  session: SessionSummary | null;
};

/**
 * `keepEmpty` 为真时（输入框里还有没发出去的草稿）不自动选中最近会话：
 * 用户重新打开时应该回到他没收尾的那条输入，而不是被自动带进别的会话。
 */
export function useActiveSession(
  sessions: SessionSummary[],
  loading: boolean,
  keepEmpty = false,
): ActiveSessionController {
  const [activeId, setActiveIdState] = useState<string | null>(readSessionFromUrl);
  /** 不在主列表里的当前会话（子会话）；与 activeId 对齐后才采用 */
  const [resolved, setResolved] = useState<SessionSummary | null>(null);
  /** 默认选中只发生一次（见下方 effect） */
  const pickedRef = useRef(false);

  const setActiveId = useCallback((sessionId: string | null) => {
    setActiveIdState(sessionId);
    writeSessionToUrl(sessionId, "push");
  }, []);

  const clearActive = useCallback(() => {
    setActiveIdState(null);
    writeSessionToUrl(null, "replace");
  }, []);

  /**
   * URL 未指定会话时，列表就绪后默认选中最近一个——只做一次。
   * 之后不再自动纠偏：用户主动回到空态（新建）或首发失败，都不该被拽进别的会话。
   */
  useEffect(() => {
    if (pickedRef.current || loading) return;
    // 判定一次就落定：之后用户主动回到空态（新建 / 在目录中新建）不再被自动纠正
    pickedRef.current = true;
    if (activeId !== null || keepEmpty) return;
    const first = sessions[0];
    if (!first) return;
    setActiveIdState(first.id);
    writeSessionToUrl(first.id, "replace");
  }, [activeId, keepEmpty, loading, sessions]);

  /** 主列表里找不到当前会话时补一次详情：子会话据此可用，归档 / 不存在才清空 */
  useEffect(() => {
    if (activeId === null) {
      setResolved(null);
      return;
    }
    if (sessions.some((item) => item.id === activeId)) {
      setResolved(null);
      return;
    }
    if (loading) return;

    let cancelled = false;
    void (async () => {
      try {
        const { session } = await api.sessions.info(activeId);
        if (cancelled) return;
        if (session.deletedAt) {
          clearActive();
          return;
        }
        setResolved(session);
      } catch (error) {
        if (cancelled) return;
        // 确认不可用（不存在 / id 非法）才清空；网络等临时故障保留选中项，避免把用户踢出子会话
        if (
          error instanceof ApiRequestError &&
          (error.code === ERROR_CODES.notFound || error.code === ERROR_CODES.invalidRequest)
        ) {
          clearActive();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, clearActive, loading, sessions]);

  // 浏览器前进 / 后退：URL 是选中项的事实源
  useEffect(() => {
    const onPopState = () => setActiveIdState(readSessionFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const listed = sessions.find((item) => item.id === activeId) ?? null;
  const session = listed ?? (resolved?.id === activeId ? resolved : null);

  return { activeId, setActiveId, session };
}
