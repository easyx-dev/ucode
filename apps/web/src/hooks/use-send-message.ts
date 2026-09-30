/** 发送消息：乐观插入用户消息并向服务端投递，生成结果由全局事件流回传 */
import { useCallback, useState } from "react";

import { api, describeError } from "@/lib/api";
import { appendUserItem, removeUserItem } from "@/lib/chat-reducer";
import type { ChatItem, SessionMode, ThinkingLevel } from "@/lib/types";

/** 空态首发时用来建会话的初始设置 */
export type SessionSeed = {
  cwd?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  mode?: SessionMode;
};

type SendMessageOptions = {
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
  readItems,
  apply,
  onError,
  markPending,
  clearPending,
}: SendMessageOptions) {
  /** prompt 请求本身的在途状态；消息区提示由 pending / running 承担 */
  const [sending, setSending] = useState(false);

  /**
   * 往指定会话投递一条消息；返回是否已被受理。
   * 目标 id 由调用方显式给出（首发时是刚建好的会话），不依赖 React 状态的传播。
   */
  const send = useCallback(
    async (text: string, sessionId: string): Promise<boolean> => {
      onError(null);
      const optimistic = appendUserItem(readItems(), text);
      apply(optimistic.items);
      setSending(true);
      // 立刻给出反馈：首个 token 都算在这段等待里
      markPending();
      try {
        await api.messages.prompt({ sessionId, text });
        return true;
      } catch (error) {
        // 没投出去就别在消息区留一条发不出去的消息（调用方会把原文还回输入框）
        apply(removeUserItem(readItems(), optimistic.id));
        onError(describeError(error));
        clearPending();
        return false;
      } finally {
        setSending(false);
      }
    },
    [apply, clearPending, markPending, onError, readItems],
  );

  return { sending, send };
}
