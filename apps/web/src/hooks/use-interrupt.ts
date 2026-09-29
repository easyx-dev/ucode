/** 中断当前生成：只需通知服务端，最终状态由事件流带回来 */
import { useCallback } from "react";

import { api } from "@/lib/api";

export function useInterrupt(sessionId: string | null) {
  return useCallback(async () => {
    if (!sessionId) return;
    try {
      await api.messages.interrupt(sessionId);
    } catch {
      // 忽略：中断失败时服务端仍会继续上报事件
    }
  }, [sessionId]);
}
