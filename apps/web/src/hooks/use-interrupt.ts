/** 中断当前生成：先让服务端 abort，再断开前端流 */
import { type RefObject, useCallback } from "react";

import { api } from "@/lib/api";

export function useInterrupt(
  sessionId: string | null,
  abortRef: RefObject<AbortController | null>,
) {
  return useCallback(async () => {
    if (!sessionId) return;
    try {
      await api.messages.interrupt(sessionId);
    } catch {
      // 忽略：即使中断失败也断开前端流
    }
    abortRef.current?.abort();
  }, [abortRef, sessionId]);
}
