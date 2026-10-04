/** 会话消息流：持有消息列表，装配快照/接续与发送 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useSessionStream } from "@/hooks/use-session-stream";
import type { ComposerPayload } from "@/lib/composer-payload";
import { sdk } from "@/lib/sdk";
import type { ChatItem, SessionCreateRequest, SessionSummary, SubagentStreams } from "@/lib/types";

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
  send: (payload: ComposerPayload, seed?: SessionCreateRequest) => Promise<SendResult>;
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
  createSession: (seed: SessionCreateRequest) => Promise<SessionSummary | null>;
};

export function useChat(sessionId: string | null, options: ChatOptions): ChatController {
  const { onSettled, onSessionCreated, createSession } = options;
  const stream = useSessionStream(sessionId);
  /** prompt 请求本身的在途状态；消息区提示由 pending / running 承担 */
  const [sending, setSending] = useState(false);

  const sendTo = useCallback(async (payload: ComposerPayload, targetId: string) => {
    setSending(true);
    try {
      return await sdk.sessionStream.send(targetId, payload);
    } finally {
      setSending(false);
    }
  }, []);

  const send = useCallback(
    async (payload: ComposerPayload, seed: SessionCreateRequest = {}): Promise<SendResult> => {
      if (sessionId) return { sessionId, admitted: await sendTo(payload, sessionId) };

      // 首发：先把草稿提升成真会话，拿到 id 再投递，不依赖 React 状态的传播
      const created = await createSession(seed);
      if (!created) return { sessionId: null, admitted: false };

      // 先登记为「已知空历史」再切过去：乐观插入立刻落在新会话自己的 store 上可见，
      // 又不会触发一次可能覆盖乐观消息的空快照
      sdk.sessionStream.seed(created.id);
      onSessionCreated?.(created.id);
      const admitted = await sendTo(payload, created.id);
      // 受理后补一次快照：把首条用户消息换成带 pi 条目 id 的权威版本（编辑 / 分叉需要它）
      if (admitted) sdk.sessionStream.refresh(created.id);
      return { sessionId: created.id, admitted };
    },
    [createSession, onSessionCreated, sendTo, sessionId],
  );

  const edit = useCallback(
    async (entryId: string, text: string): Promise<boolean> => {
      if (!sessionId) return false;
      return sdk.sessionStream.edit(sessionId, entryId, text);
    },
    [sessionId],
  );

  const stop = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await sdk.sessionStream.interrupt(sessionId);
  }, [sessionId]);

  // 一轮生成结束（running 由真变假）后刷新会话列表的标题与更新时间
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (wasRunningRef.current && !stream.running) onSettled?.();
    wasRunningRef.current = stream.running;
  }, [onSettled, stream.running]);

  return {
    items: stream.items,
    subagents: stream.subagents,
    streaming: stream.running || sending || stream.pending,
    // 活动事件可能先于 prompt 回执到达，此时 running 已接手，pending 不应再显示
    pending: stream.pending && !stream.running,
    error: stream.error,
    loadingHistory: stream.loadingHistory,
    send,
    edit,
    stop,
  };
}
