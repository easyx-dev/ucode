import { useCallback, useEffect, useRef, useState } from "react";

import { api, sendMessageUrl } from "@/lib/api";
import { readSseStream } from "@/lib/sse";
import type { ChatItem, MessageBlock, MessageDTO, MessageRole } from "@/lib/types";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const lastLiveIndex = (items: ChatItem[], role: MessageRole): number => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && item.live && item.role === role) return index;
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

let localId = 0;

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

/** 会话消息流：历史加载 + SSE 增量渲染 */
export function useChat(sessionId: string | null, onSettled?: () => void) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setError(null);
    setItems([]);

    if (!sessionId) return;

    let cancelled = false;
    setLoadingHistory(true);
    void (async () => {
      try {
        const data = await api.messages.list(sessionId);
        if (!cancelled) setItems(data.messages.map((message) => ({ ...message, live: false })));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const reduce = useCallback((items: ChatItem[], event: string, payload: unknown): ChatItem[] => {
    const data = asRecord(payload);
    const next = [...items];

    switch (event) {
      case "message_start": {
        if (data.role === "assistant") {
          next.push({
            id: `live-assistant-${Date.now()}`,
            role: "assistant",
            blocks: [],
            live: true,
            timestamp: Date.now(),
          });
        }
        return next;
      }

      case "text_delta": {
        const index = lastLiveIndex(next, "assistant");
        if (index < 0) return next;
        next[index] = appendBlock(next[index]!, "text", String(data.delta ?? ""));
        return next;
      }

      case "thinking_delta": {
        const index = lastLiveIndex(next, "assistant");
        if (index < 0) return next;
        next[index] = appendBlock(next[index]!, "thinking", String(data.delta ?? ""));
        return next;
      }

      case "tool_call": {
        const index = lastLiveIndex(next, "assistant");
        if (index < 0) return next;
        const item = next[index]!;
        const block: MessageBlock = {
          type: "toolCall",
          id: String(data.toolCallId ?? ""),
          name: String(data.toolName ?? "tool"),
          args: data.args,
        };
        next[index] = { ...item, blocks: [...item.blocks, block] };
        return next;
      }

      case "tool_start": {
        next.push({
          id: `live-tool-${String(data.toolCallId ?? Date.now())}`,
          role: "tool",
          blocks: [{ type: "text", text: "" }],
          toolName: String(data.toolName ?? "tool"),
          isError: false,
          live: true,
          timestamp: Date.now(),
        });
        return next;
      }

      case "tool_update":
      case "tool_end": {
        const target = `live-tool-${String(data.toolCallId ?? "")}`;
        const index = next.findIndex((item) => item.id === target);
        if (index < 0) return next;
        next[index] = {
          ...next[index]!,
          blocks: [{ type: "text", text: String(data.text ?? "") }],
          isError: Boolean(data.isError),
        };
        return next;
      }

      case "message_end": {
        const message = payload as MessageDTO;
        const role = message.role;

        // 工具结果优先用 toolCallId 精确匹配（pi 默认并发执行工具，按“最后一个”会错位）
        if (role === "tool" && message.toolCallId) {
          const target = `live-tool-${message.toolCallId}`;
          const exact = next.findIndex((item) => item.id === target);
          if (exact >= 0) {
            next[exact] = { ...message, live: false };
            return next;
          }
        }

        if (role === "assistant" || role === "tool" || role === "user") {
          const index = lastLiveIndex(next, role);
          if (index >= 0) {
            next[index] = { ...message, live: false };
            return next;
          }
        }
        next.push({ ...message, live: false });
        return next;
      }

      default:
        return next;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId || streaming) return;
      setError(null);

      setItems((prev) => [
        ...prev,
        {
          id: `live-user-${(localId += 1)}`,
          role: "user",
          blocks: [{ type: "text", text }],
          live: true,
          timestamp: Date.now(),
        },
      ]);

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
              setItems((prev) => prev.map((item) => (item.live ? { ...item, live: false } : item)));
              return;
            }
            setItems((prev) => reduce(prev, event, payload));
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
        setItems((prev) => prev.map((item) => (item.live ? { ...item, live: false } : item)));
        settledRef.current?.();
      }
    },
    [reduce, sessionId, streaming],
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
