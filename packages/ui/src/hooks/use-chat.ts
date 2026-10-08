/** 会话消息流：订阅 SDK 的 messages store，装配「无会话时先建会话再投递」的发送流程 */
import type { CompactionNotice, SessionCreateRequest, SessionSummary } from "@ucode/contracts";
import type { ChatItem, EditMessagePayload, SubagentStreams } from "@ucode/sdk";
import { useCallback, useRef, useState } from "react";

import type { ComposerPayload } from "../lib/composer-payload";
import { useErrorText } from "../lib/error";
import { useClient } from "../provider";
import { useSessionStream } from "./use-session-stream";

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
  /** 本轮进行的是上下文压缩：尾部提示据此换文案 */
  compacting: boolean;
  /** 当前语言渲染的错误文案 */
  error: string | null;
  loadingHistory: boolean;
  /** 发送一条消息；还没有会话时先建会话（`seed` 是它的初始设置） */
  send: (payload: ComposerPayload, seed?: SessionCreateRequest) => Promise<SendResult>;
  /** 编辑一条已发送的用户消息并重发；引用与附件一并带上，刷新由 transcript_reset 事件驱动 */
  edit: (entryId: string, payload: EditMessagePayload) => Promise<boolean>;
  /** 中断当前生成 */
  stop: () => Promise<void>;
  /** 手动压缩上下文；进度走 compaction_* 事件 */
  compact: () => Promise<void>;
  /** 压缩的结果提示（正常拒绝 / 自动压缩失败）；不是错误，界面弹过轻提示后调 ack 清掉 */
  compactionNotice: CompactionNotice | null;
  ackCompactionNotice: () => void;
  /** 忽略本次计划的决策表单；表单收起由 transcript_reset 事件驱动 */
  ignorePlan: () => Promise<void>;
  /** 批准计划：服务端注入开工指令并起一轮（模式由调用方先切回 build） */
  approvePlan: () => Promise<void>;
};

type ChatOptions = {
  /** 首发建好会话后回调，调用方把它设为当前会话，事件流随即接上 */
  onSessionCreated?: (sessionId: string) => void;
};

export function useChat(sessionId: string | null, options: ChatOptions = {}): ChatController {
  const client = useClient();
  const stream = useSessionStream(sessionId);
  const error = useErrorText(stream.error);
  /** prompt 请求本身的在途状态；消息区提示由 pending / running 承担 */
  const [sending, setSending] = useState(false);
  const onSessionCreatedRef = useRef(options.onSessionCreated);
  onSessionCreatedRef.current = options.onSessionCreated;

  const sendTo = useCallback(
    async (payload: ComposerPayload, targetId: string) => {
      setSending(true);
      try {
        return await client.messages.send(targetId, payload);
      } finally {
        setSending(false);
      }
    },
    [client],
  );

  const send = useCallback(
    async (payload: ComposerPayload, seed: SessionCreateRequest = {}): Promise<SendResult> => {
      if (sessionId) return { sessionId, admitted: await sendTo(payload, sessionId) };

      // 首发：先把草稿提升成真会话，拿到 id 再投递
      const created: SessionSummary | null = await client.sessions.create(seed);
      if (!created) return { sessionId: null, admitted: false };

      // 先登记为「已知空历史」再切过去：乐观插入立刻落在新会话自己的 store 上可见，
      // 又不会触发一次可能覆盖乐观消息的空快照
      client.messages.seed(created.id);
      onSessionCreatedRef.current?.(created.id);
      const admitted = await sendTo(payload, created.id);
      // 受理后补一次快照：把首条用户消息换成带 pi 条目 id 的权威版本（编辑 / 分叉需要它）
      if (admitted) client.messages.refresh(created.id);
      return { sessionId: created.id, admitted };
    },
    [client, sendTo, sessionId],
  );

  const edit = useCallback(
    async (entryId: string, payload: EditMessagePayload): Promise<boolean> => {
      if (!sessionId) return false;
      return client.messages.edit(sessionId, entryId, payload);
    },
    [client, sessionId],
  );

  const stop = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await client.messages.interrupt(sessionId);
  }, [client, sessionId]);

  const compact = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await client.messages.compact(sessionId);
  }, [client, sessionId]);

  const ackCompactionNotice = useCallback((): void => {
    if (!sessionId) return;
    client.messages.ackCompactionNotice(sessionId);
  }, [client, sessionId]);

  const ignorePlan = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await client.messages.ignorePlan(sessionId);
  }, [client, sessionId]);

  const approvePlan = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    await client.messages.approvePlan(sessionId);
  }, [client, sessionId]);

  // 会话列表的运行态与摘要由 session_updated 事件驱动，无需在落定后再刷新

  return {
    items: stream.items,
    subagents: stream.subagents,
    // 在途的三种情况合并成一个「进行中」：列表尾部据此显示工作中提示
    streaming: stream.running || sending || stream.pending,
    compacting: stream.compacting,
    error,
    loadingHistory: stream.loadingHistory,
    send,
    edit,
    stop,
    compact,
    compactionNotice: stream.compactionNotice,
    ackCompactionNotice,
    ignorePlan,
    approvePlan,
  };
}
