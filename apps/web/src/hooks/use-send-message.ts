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
  /** 发送瞬间进入「等首个事件」的 pending 态，避免消息区空窗 */
  markPending: () => void;
  /** prompt 请求失败时回收 pending */
  clearPending: () => void;
};

export function useSendMessage({
  sessionId,
  readItems,
  apply,
  onError,
  markPending,
  clearPending,
}: SendMessageOptions) {
  /** prompt 请求本身的在途状态；消息区提示由 pending / running 承担 */
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      onError(null);
      apply(appendUserItem(readItems(), text));
      setSending(true);
      // 立刻给出反馈：建会话 + 首个 token 都算在这段等待里
      markPending();
      try {
        await api.messages.prompt({ sessionId, text });
      } catch (error) {
        onError(describeError(error));
        clearPending();
      } finally {
        setSending(false);
      }
    },
    [apply, clearPending, markPending, onError, readItems, sessionId],
  );

  return { sending, send };
}
