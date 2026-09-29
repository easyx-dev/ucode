/** 发送消息并消费流式响应：乐观插入用户消息，事件归并交给 chat-reducer */
import { useCallback, useRef, useState } from "react";

import { useInterrupt } from "@/hooks/use-interrupt";
import { describeError, promptStream } from "@/lib/api";
import { appendUserItem, reduceEvent, settle } from "@/lib/chat-reducer";
import type { ChatItem } from "@/lib/types";

type SendMessageOptions = {
  sessionId: string | null;
  /** 读取当前消息列表（以 ref 为准，避免闭包拿到旧数组） */
  readItems: () => ChatItem[];
  apply: (items: ChatItem[]) => void;
  onError: (message: string | null) => void;
  /** 一轮结束后触发（用于刷新会话列表里的标题与更新时间） */
  onSettled?: () => void;
};

export function useSendMessage({
  sessionId,
  readItems,
  apply,
  onError,
  onSettled,
}: SendMessageOptions) {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleEvent = useCallback(
    (event: string, payload: unknown) => {
      if (event === "error") {
        const data = payload as { message?: string };
        onError(data?.message ?? "生成失败");
        return;
      }
      if (event === "done" || event === "agent_settled") {
        apply(settle(readItems()));
        return;
      }
      apply(reduceEvent(readItems(), event, payload));
    },
    [apply, onError, readItems],
  );

  const send = useCallback(
    async (text: string) => {
      if (!sessionId || streaming) return;
      onError(null);
      apply(appendUserItem(readItems(), text));

      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);

      try {
        await promptStream(sessionId, text, handleEvent, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) onError(describeError(error));
      } finally {
        setStreaming(false);
        abortRef.current = null;
        apply(settle(readItems()));
        onSettled?.();
      }
    },
    [apply, handleEvent, onError, onSettled, readItems, sessionId, streaming],
  );

  const stop = useInterrupt(sessionId, abortRef);

  return { streaming, send, stop };
}
