/** 会话消息流：持有消息列表，装配历史加载与发送 */
import { useCallback, useRef, useState } from "react";

import { useSendMessage } from "@/hooks/use-send-message";
import { useSessionHistory } from "@/hooks/use-session-history";
import type { ChatItem } from "@/lib/types";

export type ChatController = {
  items: ChatItem[];
  streaming: boolean;
  error: string | null;
  loadingHistory: boolean;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
};

export function useChat(sessionId: string | null, onSettled?: () => void): ChatController {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * 消息列表以 ref 为准：流式回调在 React 状态更新之外推进列表，
   * 这样事件归并只跑一次，不必把「生成 id / 取时间戳」塞进 setState updater。
   */
  const itemsRef = useRef<ChatItem[]>([]);
  const apply = useCallback((next: ChatItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const readItems = useCallback(() => itemsRef.current, []);
  const { loadingHistory } = useSessionHistory({ sessionId, apply, onError: setError });
  const { streaming, send, stop } = useSendMessage({
    sessionId,
    readItems,
    apply,
    onError: setError,
    onSettled,
  });

  return { items, streaming, error, loadingHistory, send, stop };
}
