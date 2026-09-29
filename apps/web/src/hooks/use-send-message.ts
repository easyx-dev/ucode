/** 发送消息：乐观插入用户消息并向服务端投递，生成结果由全局事件流回传 */
import { useCallback, useState } from "react";

import { api, describeError } from "@/lib/api";
import { appendUserItem } from "@/lib/chat-reducer";
import type { ChatItem } from "@/lib/types";

type SendMessageOptions = {
  sessionId: string | null;
  /** 读取当前消息列表（以 ref 为准，避免闭包拿到旧数组） */
  readItems: () => ChatItem[];
  apply: (items: ChatItem[]) => void;
  onError: (message: string | null) => void;
};

export function useSendMessage({ sessionId, readItems, apply, onError }: SendMessageOptions) {
  /** prompt 请求本身的在途状态；生成是否结束看 running */
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      onError(null);
      apply(appendUserItem(readItems(), text));
      setSending(true);
      try {
        await api.messages.prompt({ sessionId, text });
      } catch (error) {
        onError(describeError(error));
      } finally {
        setSending(false);
      }
    },
    [apply, onError, readItems, sessionId],
  );

  return { sending, send };
}
