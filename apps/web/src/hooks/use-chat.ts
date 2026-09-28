/** 会话消息流：历史加载 + SSE 增量渲染 */
import { useCallback, useEffect, useRef, useState } from "react";

import { api, sendMessageUrl } from "@/lib/api";
import { readSseStream } from "@/lib/sse";
import type { ChatItem, MessageBlock, MessageDTO, MessageRole } from "@/lib/types";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

let localId = 0;
const nextLocalId = (): number => {
  localId += 1;
  return localId;
};

const lastLiveIndex = (items: ChatItem[], role: MessageRole): number => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.live && item.role === role) return index;
  }
  return -1;
};

const appendBlock = (item: ChatItem, type: "text" | "thinking", delta: string): ChatItem => {
  const blocks = [...item.blocks];
  const last = blocks[blocks.length - 1];

  if (last && last.type === type) {
    blocks[blocks.length - 1] = { type, text: last.text + delta };
  } else {
    blocks.push({ type, text: delta });
  }
  return { ...item, blocks };
};

const replaceAt = (items: ChatItem[], index: number, item: ChatItem): ChatItem[] => {
  const next = [...items];
  next[index] = item;
  return next;
};

/** 把一条 SSE 事件并入消息列表（纯函数；id 与时间戳在进入前生成） */
const reduceEvent = (items: ChatItem[], event: string, payload: unknown): ChatItem[] => {
  const data = asRecord(payload);

  switch (event) {
    case "message_start": {
      if (data.role !== "assistant") return items;
      const item: ChatItem = {
        id: `live-assistant-${nextLocalId()}`,
        role: "assistant",
        blocks: [],
        live: true,
        timestamp: Date.now(),
      };
      return [...items, item];
    }

    case "text_delta":
    case "thinking_delta": {
      const index = lastLiveIndex(items, "assistant");
      const item = items[index];
      if (index < 0 || !item) return items;
      const type = event === "text_delta" ? "text" : "thinking";
      return replaceAt(items, index, appendBlock(item, type, String(data.delta ?? "")));
    }

    case "tool_call": {
      const index = lastLiveIndex(items, "assistant");
      const item = items[index];
      if (index < 0 || !item) return items;
      const block: MessageBlock = {
        type: "toolCall",
        id: String(data.toolCallId ?? ""),
        name: String(data.toolName ?? "tool"),
        args: data.args,
      };
      return replaceAt(items, index, { ...item, blocks: [...item.blocks, block] });
    }

    case "tool_start": {
      const item: ChatItem = {
        id: `live-tool-${String(data.toolCallId ?? nextLocalId())}`,
        role: "tool",
        blocks: [{ type: "text", text: "" }],
        toolName: String(data.toolName ?? "tool"),
        isError: false,
        live: true,
        timestamp: Date.now(),
      };
      return [...items, item];
    }

    case "tool_update":
    case "tool_end": {
      const target = `live-tool-${String(data.toolCallId ?? "")}`;
      const index = items.findIndex((item) => item.id === target);
      const item = items[index];
      if (index < 0 || !item) return items;
      return replaceAt(items, index, {
        ...item,
        blocks: [{ type: "text", text: String(data.text ?? "") }],
        isError: Boolean(data.isError),
      });
    }

    case "message_end": {
      const message = payload as MessageDTO;
      const { role } = message;

      // 工具结果优先用 toolCallId 精确匹配（pi 默认并发执行工具，按「最后一个」会错位）
      if (role === "tool" && message.toolCallId) {
        const target = `live-tool-${message.toolCallId}`;
        const exact = items.findIndex((item) => item.id === target);
        if (exact >= 0) return replaceAt(items, exact, { ...message, live: false });
      }

      if (role === "assistant" || role === "tool" || role === "user") {
        const index = lastLiveIndex(items, role);
        if (index >= 0) return replaceAt(items, index, { ...message, live: false });
      }

      return [...items, { ...message, live: false }];
    }

    default:
      return items;
  }
};

const settle = (items: ChatItem[]): ChatItem[] =>
  items.map((item) => (item.live ? { ...item, live: false } : item));

/** 流还没开始就失败（如 409 未配置模型）时，尽量把服务端的原因透出来 */
const describeHttpError = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // 非 JSON，退回状态码
  }
  return `发送失败（HTTP ${response.status}）`;
};

export function useChat(sessionId: string | null, onSettled?: () => void) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  /**
   * 消息列表以 ref 为准：SSE 回调在 React 状态更新之外推进列表，
   * 这样事件归并只跑一次，不必把「生成 id / 取时间戳」塞进 setState updater。
   */
  const itemsRef = useRef<ChatItem[]>([]);
  const replaceItems = useCallback((next: ChatItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setError(null);
    replaceItems([]);

    if (!sessionId) return;

    let cancelled = false;
    setLoadingHistory(true);
    void (async () => {
      try {
        const data = await api.messages.list(sessionId);
        if (!cancelled) {
          replaceItems(data.messages.map((message) => ({ ...message, live: false })));
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [replaceItems, sessionId]);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId || streaming) return;
      setError(null);

      const userItem: ChatItem = {
        id: `live-user-${nextLocalId()}`,
        role: "user",
        blocks: [{ type: "text", text }],
        live: true,
        timestamp: Date.now(),
      };
      replaceItems([...itemsRef.current, userItem]);

      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);

      try {
        const response = await fetch(sendMessageUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, text }),
          signal: controller.signal,
        });

        if (!response.ok) {
          setError(await describeHttpError(response));
          return;
        }
        if (!response.body) {
          setError("发送失败：服务未返回流");
          return;
        }

        await readSseStream(
          response.body,
          (event, payload) => {
            if (event === "error") {
              setError(String(asRecord(payload).message ?? "生成失败"));
              return;
            }
            if (event === "done" || event === "agent_settled") {
              replaceItems(settle(itemsRef.current));
              return;
            }
            replaceItems(reduceEvent(itemsRef.current, event, payload));
          },
          controller.signal,
        );
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        replaceItems(settle(itemsRef.current));
        settledRef.current?.();
      }
    },
    [replaceItems, sessionId, streaming],
  );

  const stop = useCallback(async () => {
    if (!sessionId) return;
    try {
      await api.messages.interrupt(sessionId);
    } catch {
      // 忽略：即使中断失败也断开前端流
    }
    abortRef.current?.abort();
  }, [sessionId]);

  return { items, streaming, error, loadingHistory, send, stop };
}
