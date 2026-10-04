/** 会话消息流：持有消息列表，装配快照/接续与发送 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useEditMessage } from "@/hooks/use-edit-message";
import { useInterrupt } from "@/hooks/use-interrupt";
import { type SessionSeed, useSendMessage } from "@/hooks/use-send-message";
import { useSessionStream } from "@/hooks/use-session-stream";
import type { ComposerPayload } from "@/lib/composer-payload";
import type { ChatItem, SessionSummary, SubagentStreams } from "@/lib/types";

/** 发送结果：消息投给哪个会话（`null` 表示连会话都没建出来），以及是否已被受理 */
export type SendResult = {
  sessionId: string | null;
  admitted: boolean;
};

export type ChatController = {
  items: ChatItem[];
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents: SubagentStreams;
  streaming: boolean;
  /** 已发送、还没出现任何生成内容：消息区尾部显示等待指示 */
  pending: boolean;
  error: string | null;
  loadingHistory: boolean;
  /** 发送一条消息；还没有会话时先建会话（`seed` 是它的初始设置） */
  send: (payload: ComposerPayload, seed?: SessionSeed) => Promise<SendResult>;
  /** 编辑一条已发送的用户消息并重发；刷新由 transcript_reset 事件驱动 */
  edit: (entryId: string, text: string) => Promise<boolean>;
  stop: () => Promise<void>;
};

type ChatOptions = {
  /** 一轮生成结束后刷新会话列表的标题与更新时间 */
  onSettled?: () => void;
  /** 首发建好会话后回调，调用方把它设为当前会话，事件流随即接上 */
  onSessionCreated?: (sessionId: string) => void;
  /** 首发建会话（失败返回 null，调用方已提示） */
  createSession: (seed: SessionSeed) => Promise<SessionSummary | null>;
};

export function useChat(sessionId: string | null, options: ChatOptions): ChatController {
  const { onSettled, onSessionCreated, createSession } = options;
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
  const { loadingHistory, running, pending, subagents, markPending, clearPending } =
    useSessionStream({
      sessionId,
      readItems,
      apply,
      onError: setError,
    });
  const { sending, send: sendTo } = useSendMessage({
    readItems,
    apply,
    onError: setError,
    markPending,
    clearPending,
  });
  const { edit } = useEditMessage({ sessionId, onError: setError });
  const stop = useInterrupt(sessionId);

  const send = useCallback(
    async (payload: ComposerPayload, seed: SessionSeed = {}): Promise<SendResult> => {
      if (sessionId) return { sessionId, admitted: await sendTo(payload, sessionId) };

      // 首发：先把草稿提升成真会话，拿到 id 再投递，不依赖 React 状态的传播
      const created = await createSession(seed);
      if (!created) return { sessionId: null, admitted: false };

      const admitted = await sendTo(payload, created.id);
      // 受理之后再切过去：切换会让事件流重新取快照，此时快照里必然已经有这条消息，
      // 乐观插入的那条会被服务端版本覆盖（失败时则是被清掉，不会在消息区留个发不出去的残影）
      onSessionCreated?.(created.id);
      return { sessionId: created.id, admitted };
    },
    [createSession, onSessionCreated, sendTo, sessionId],
  );

  // 一轮生成结束（running 由真变假）后刷新会话列表的标题与更新时间
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (wasRunningRef.current && !running) onSettled?.();
    wasRunningRef.current = running;
  }, [onSettled, running]);

  return {
    items,
    subagents,
    streaming: running || sending || pending,
    // 活动事件可能先于 prompt 回执到达，此时 running 已接手，pending 不应再显示
    pending: pending && !running,
    error,
    loadingHistory,
    send,
    edit,
    stop,
  };
}
