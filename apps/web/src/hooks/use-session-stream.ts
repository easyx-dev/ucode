/** 会话消息流：打开会话时取快照（含在途投影），随后由全局事件流驱动 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api, describeApiError, describeError } from "@/lib/api";
import { asRecord, reduceEvent, settle } from "@/lib/chat-reducer";
import { eventStream } from "@/lib/event-stream";
import type {
  ChatItem,
  EventName,
  ServerEventPayload,
  SubagentStream,
  SubagentStreams,
} from "@/lib/types";

/** 会让界面进入「生成中」的事件；agent_settled 是唯一的结束边界 */
const ACTIVITY_EVENTS = new Set<EventName>([
  "message_start",
  "text_delta",
  "thinking_delta",
  "tool_call",
  "tool_start",
  "tool_update",
  "tool_end",
  "message_end",
  "queue_update",
  "compaction_start",
  "compaction_end",
]);

type SessionStreamOptions = {
  sessionId: string | null;
  readItems: () => ChatItem[];
  apply: (items: ChatItem[]) => void;
  onError: (message: string | null) => void;
};

export function useSessionStream({ sessionId, readItems, apply, onError }: SessionStreamOptions): {
  loadingHistory: boolean;
  running: boolean;
  /** 已受理、还没收到首个活动事件；用来补上「点发送」到「首个事件」之间的空窗 */
  pending: boolean;
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents: SubagentStreams;
  /** 发送时调用，立即进入 pending；首个活动事件 / 收尾 / 出错时自动消除 */
  markPending: () => void;
  /** prompt 请求本身失败时调用，回收 pending */
  clearPending: () => void;
} {
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState(false);
  const [subagents, setSubagents] = useState<SubagentStreams>({});

  const sessionIdRef = useRef(sessionId);
  const hydratingRef = useRef(false);
  const bufferRef = useRef<ServerEventPayload[]>([]);
  const tokenRef = useRef(0);
  const connectedOnceRef = useRef(false);
  const handlersRef = useRef({ readItems, apply, onError });
  /** 子智能体进度以 ref 为准，供事件回调同步读写 */
  const subagentsRef = useRef<SubagentStreams>({});
  /** 子会话 id → 父会话里这次 subagent 调用的 toolCallId */
  const childToolCallsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    handlersRef.current = { readItems, apply, onError };
  });

  const markPending = useCallback(() => setPending(true), []);
  const clearPending = useCallback(() => setPending(false), []);

  const applySubagents = useCallback((next: SubagentStreams) => {
    subagentsRef.current = next;
    setSubagents(next);
  }, []);

  /** 就地更新某个子智能体的进度；没有对应条目时忽略 */
  const updateSubagent = useCallback(
    (toolCallId: string, update: (stream: SubagentStream) => SubagentStream) => {
      const current = subagentsRef.current;
      const existing = current[toolCallId];
      if (!existing) return;
      applySubagents({ ...current, [toolCallId]: update(existing) });
    },
    [applySubagents],
  );

  /** 子会话自身的帧经关联后归入对应嵌套视图；`agent_settled` 表示它已经跑完 */
  const applyChildFrame = useCallback(
    (toolCallId: string, frame: ServerEventPayload) => {
      updateSubagent(toolCallId, (stream) =>
        frame.type === "agent_settled"
          ? { ...stream, items: settle(stream.items), done: true }
          : { ...stream, items: reduceEvent(stream.items, frame.type, frame.data) },
      );
    },
    [updateSubagent],
  );

  /** 应用一条事件帧：维护 running，再交给 reducer 归并 */
  const applyFrame = useCallback(
    (frame: ServerEventPayload) => {
      const { apply: applyItems, readItems: read } = handlersRef.current;

      // 子智能体只发关联帧：建立 / 解除 childId → toolCallId 映射，进度靠子会话自身的帧
      if (frame.type === "subagent_start") {
        const data = asRecord(frame.data);
        const toolCallId = String(data.toolCallId ?? "");
        const childId = String(data.sessionId ?? "");
        if (!toolCallId || !childId) return;
        childToolCallsRef.current.set(childId, toolCallId);
        applySubagents({
          ...subagentsRef.current,
          [toolCallId]: {
            sessionId: childId,
            description: String(data.description ?? ""),
            items: subagentsRef.current[toolCallId]?.items ?? [],
            done: false,
            isError: false,
          },
        });
        return;
      }

      if (frame.type === "subagent_end") {
        const data = asRecord(frame.data);
        const toolCallId = String(data.toolCallId ?? "");
        const childId = String(data.sessionId ?? "");
        if (childId) childToolCallsRef.current.delete(childId);
        updateSubagent(toolCallId, (stream) => ({
          ...stream,
          items: settle(stream.items),
          done: true,
          isError: Boolean(data.isError),
        }));
        return;
      }

      if (frame.type === "agent_settled") {
        setRunning(false);
        setPending(false);
        applyItems(settle(read()));
        // 父会话整体收尾时，残留的子智能体一并收尾（正常路径 subagent_end 已收）
        const leftovers = Object.entries(subagentsRef.current).filter(
          ([, stream]) => !stream.done || stream.items.some((item) => item.live),
        );
        if (leftovers.length > 0) {
          applySubagents({
            ...subagentsRef.current,
            ...Object.fromEntries(
              leftovers.map(([id, stream]) => [
                id,
                { ...stream, items: settle(stream.items), done: true },
              ]),
            ),
          });
        }
        return;
      }

      // 首个活动事件到达即接手生成态，pending 让位给 running
      if (ACTIVITY_EVENTS.has(frame.type)) {
        setRunning(true);
        setPending(false);
      }
      applyItems(reduceEvent(read(), frame.type, frame.data));
    },
    [applySubagents, updateSubagent],
  );

  /**
   * 取快照并接续。服务端把投影与快照序号放在同一次同步读取里返回，
   * 所以「丢弃 seq <= 快照序号的缓冲帧、应用其余帧」即可无缝衔接：
   * 不必区分哪些增量来自断线前，也不会重复渲染。
   */
  const hydrate = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;

    const token = tokenRef.current + 1;
    tokenRef.current = token;
    hydratingRef.current = true;
    bufferRef.current = [];
    setLoadingHistory(true);

    const { apply: applyItems, onError: report } = handlersRef.current;

    try {
      const snapshot = await api.messages.list(id);
      if (token !== tokenRef.current) return;

      applyItems(
        snapshot.messages.map((message) => ({
          ...message,
          live: message.id === snapshot.liveMessageId,
        })),
      );
      setRunning(snapshot.running);
      setPending(false);
      report(null);

      const buffered = bufferRef.current;
      bufferRef.current = [];
      hydratingRef.current = false;
      for (const frame of buffered) {
        if (frame.seq <= snapshot.seq) continue;
        applyFrame(frame);
      }
    } catch (error) {
      if (token === tokenRef.current) report(describeError(error));
    } finally {
      if (token === tokenRef.current) {
        hydratingRef.current = false;
        setLoadingHistory(false);
      }
    }
  }, [applyFrame]);

  // 全局订阅只建立一次
  useEffect(() => {
    eventStream.start();

    const offFrame = eventStream.subscribe((frame) => {
      if (frame.type === "server.connected") return;
      if (frame.type === "error") {
        if (frame.sessionId && frame.sessionId !== sessionIdRef.current) return;
        if (frame.sessionId) {
          setRunning(false);
          setPending(false);
        }
        handlersRef.current.onError(describeApiError(frame.code, frame.message, frame.params));
        return;
      }
      if (frame.sessionId !== sessionIdRef.current) {
        // 子会话自身的帧：只在已建立关联、且不在取快照时归入嵌套视图；
        // 快照对嵌套进度不做重建，取快照期间直接丢弃
        const toolCallId = childToolCallsRef.current.get(frame.sessionId);
        if (!toolCallId || hydratingRef.current) return;
        applyChildFrame(toolCallId, frame);
        return;
      }
      // 活动分支变了：本地历史作废，重新取快照（token 守卫会作废在途的旧快照）
      if (frame.type === "transcript_reset") {
        void hydrate();
        return;
      }
      if (hydratingRef.current) {
        bufferRef.current.push(frame);
        return;
      }
      applyFrame(frame);
    });

    // 只有「重连」才需要重新取快照补齐缺口；首次连接与挂载/切换时的
    // hydration 重合，跳过以免多拉一次快照。
    const offStatus = eventStream.onStatus((isConnected) => {
      if (!isConnected) return;
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      void hydrate();
    });

    return () => {
      offFrame();
      offStatus();
    };
  }, [applyChildFrame, applyFrame, hydrate]);

  // 切换会话：清空上一会话的内容与错误，作废在途 hydration 后重新取快照
  useEffect(() => {
    sessionIdRef.current = sessionId;
    tokenRef.current += 1;
    bufferRef.current = [];
    hydratingRef.current = false;
    childToolCallsRef.current = new Map();
    applySubagents({});
    setRunning(false);
    setPending(false);

    const { apply: applyItems, onError: report } = handlersRef.current;
    applyItems([]);
    report(null);

    if (!sessionId) {
      setLoadingHistory(false);
      return;
    }
    void hydrate();
  }, [applySubagents, hydrate, sessionId]);

  return { loadingHistory, running, pending, subagents, markPending, clearPending };
}
