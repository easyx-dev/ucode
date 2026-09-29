/** 会话消息流：持有消息列表，装配快照/接续与发送 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useInterrupt } from "@/hooks/use-interrupt";
import { useSendMessage } from "@/hooks/use-send-message";
import { useSessionStream } from "@/hooks/use-session-stream";
import type { ChatItem } from "@/lib/types";

export type ChatController = {
  items: ChatItem[];
  streaming: boolean;
  /** 已发送、还没出现任何生成内容：消息区尾部显示等待指示 */
  pending: boolean;
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
  const { loadingHistory, running, pending, markPending, clearPending } = useSessionStream({
    sessionId,
    readItems,
    apply,
    onError: setError,
  });
  const { sending, send } = useSendMessage({
    sessionId,
    readItems,
    apply,
    onError: setError,
    markPending,
    clearPending,
  });
  const stop = useInterrupt(sessionId);

  // 一轮生成结束（running 由真变假）后刷新会话列表的标题与更新时间
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (wasRunningRef.current && !running) onSettled?.();
    wasRunningRef.current = running;
  }, [onSettled, running]);

  return {
    items,
    streaming: running || sending || pending,
    // 活动事件可能先于 prompt 回执到达，此时 running 已接手，pending 不应再显示
    pending: pending && !running,
    error,
    loadingHistory,
    send,
    stop,
  };
}
