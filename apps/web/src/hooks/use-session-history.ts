/** 会话历史：切换会话或收到新会话 id 时重新拉取 */
import { useEffect, useState } from "react";

import { api, describeError } from "@/lib/api";
import type { ChatItem } from "@/lib/types";

type SessionHistoryOptions = {
  sessionId: string | null;
  /** 用历史消息替换当前列表 */
  apply: (items: ChatItem[]) => void;
  /** 加载失败时上报（发送侧与历史侧共用同一个错误位） */
  onError: (message: string | null) => void;
};

export function useSessionHistory({ sessionId, apply, onError }: SessionHistoryOptions): {
  loadingHistory: boolean;
} {
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    apply([]);
    onError(null);

    if (!sessionId) return;

    let cancelled = false;
    setLoadingHistory(true);
    void (async () => {
      try {
        const data = await api.messages.list(sessionId);
        if (!cancelled) apply(data.messages.map((message) => ({ ...message, live: false })));
      } catch (error) {
        if (!cancelled) onError(describeError(error));
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apply, onError, sessionId]);

  return { loadingHistory };
}
