/** 当前会话的累计 token 用量：切换会话时取一次，生成落定后再取（本轮用量此时才落盘） */
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { UsageTotals } from "@/lib/types";

export function useSessionUsage(sessionId: string | null, busy: boolean): UsageTotals | null {
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  const wasBusy = useRef(busy);

  useEffect(() => {
    if (!sessionId) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    void api.sessions
      .info(sessionId)
      .then(({ usage: next }) => {
        if (!cancelled) setUsage(next);
      })
      .catch(() => {
        // 用量只是展示，取不到就沿用上一次
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (sessionId && wasBusy.current && !busy) {
      void api.sessions
        .info(sessionId)
        .then(({ usage: next }) => setUsage(next))
        .catch(() => {});
    }
    wasBusy.current = busy;
  }, [busy, sessionId]);

  return usage;
}
