/** 发送消息：乐观插入用户消息并向服务端投递，生成结果由全局事件流回传 */
import { useCallback, useState } from "react";

import { api, describeError } from "@/lib/api";
import { appendUserItem, removeUserItem } from "@/lib/chat-reducer";
import type { ComposerPayload } from "@/lib/composer-payload";
import type { ChatItem, MessageBlock, ThinkingLevel } from "@/lib/types";

/** 空态首发时用来建会话的初始设置 */
export type SessionSeed = {
  cwd?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  mode?: string;
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

/** 载荷 → 乐观区块：正文 + 图片（本地用 data URL 立即预览，权威消息到达后替换） */
const optimisticBlocks = (payload: ComposerPayload): MessageBlock[] => [
  ...(payload.text ? [{ type: "text", text: payload.text } as const] : []),
  ...payload.images.map((image) => ({
    type: "image" as const,
    id: "",
    mimeType: image.mimeType,
    url: `data:${image.mimeType};base64,${image.data}`,
  })),
];

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
    async (payload: ComposerPayload, sessionId: string): Promise<boolean> => {
      onError(null);
      const optimistic = appendUserItem(readItems(), optimisticBlocks(payload));
      apply(optimistic.items);
      setSending(true);
      // 立刻给出反馈：首个 token 都算在这段等待里
      markPending();
      try {
        await api.messages.prompt({
          sessionId,
          text: payload.text,
          ...(payload.contexts.length > 0 ? { contexts: payload.contexts } : {}),
          ...(payload.images.length > 0 ? { images: payload.images } : {}),
        });
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
