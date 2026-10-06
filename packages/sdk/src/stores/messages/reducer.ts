/** 会话消息列表的事件归并（纯函数，便于复用与单测） */
import type { MessageBlock, MessageDTO, MessageRole } from "@ucode/contracts";

import type { ChatItem, ChatItemTiming } from "../../types";

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

let localId = 0;
const nextLocalId = (): number => {
  localId += 1;
  return localId;
};

/** 本地乐观消息的时间戳，与服务端保持一致用 ISO 8601 */
const nowIso = (): string => new Date().toISOString();

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

/** 收尾：所有还在流式生成中的条目去掉 live 标记 */
export const settle = (items: ChatItem[]): ChatItem[] =>
  items.map((item) => (item.live ? { ...item, live: false } : item));

/** 乐观插入一条用户消息（正文 + 图片区块），等权威消息后再合并；返回列表与新条目 id（失败时据此撤回） */
export const appendUserItem = (
  items: ChatItem[],
  blocks: MessageBlock[],
): { items: ChatItem[]; id: string } => {
  const id = `live-user-${nextLocalId()}`;
  return {
    id,
    items: [...items, { id, role: "user", blocks, live: true, createdAt: nowIso() }],
  };
};

/** 撤回某条乐观消息（投递失败时用）；id 已不在列表里时原样返回 */
export const removeUserItem = (items: ChatItem[], id: string): ChatItem[] =>
  items.some((item) => item.id === id) ? items.filter((item) => item.id !== id) : items;

/** 新建一条待填充的 assistant 消息（message_start） */
export const appendAssistantItem = (items: ChatItem[]): ChatItem[] => [
  ...items,
  {
    id: `live-assistant-${nextLocalId()}`,
    role: "assistant",
    blocks: [],
    live: true,
    createdAt: nowIso(),
  },
];

/** 正文 / 思考增量：追加到最近一条 live 的 assistant 消息 */
export const appendDelta = (
  items: ChatItem[],
  type: "text" | "thinking",
  delta: string,
): ChatItem[] => {
  const index = lastLiveIndex(items, "assistant");
  const item = items[index];
  if (index < 0 || !item) return items;
  return replaceAt(items, index, appendBlock(item, type, delta));
};

/** 工具调用被模型声明：追加到最近一条 live 的 assistant 消息 */
export const appendToolCall = (items: ChatItem[], block: MessageBlock): ChatItem[] => {
  const index = lastLiveIndex(items, "assistant");
  const item = items[index];
  if (index < 0 || !item) return items;
  return replaceAt(items, index, { ...item, blocks: [...item.blocks, block] });
};

/** 工具开始执行：插入一张待填充的结果卡片 */
export const startToolItem = (items: ChatItem[], data: Record<string, unknown>): ChatItem[] => [
  ...items,
  {
    id: `live-tool-${String(data.toolCallId ?? nextLocalId())}`,
    role: "tool",
    blocks: [{ type: "text", text: "" }],
    toolCallId: String(data.toolCallId ?? ""),
    toolName: String(data.toolName ?? "tool"),
    isError: false,
    live: true,
    createdAt: nowIso(),
  },
];

/** 工具执行中 / 结束：刷新对应卡片的内容 */
export const updateToolItem = (items: ChatItem[], data: Record<string, unknown>): ChatItem[] => {
  const target = `live-tool-${String(data.toolCallId ?? "")}`;
  const index = items.findIndex((item) => item.id === target);
  const item = items[index];
  if (index < 0 || !item) return items;
  return replaceAt(items, index, {
    ...item,
    blocks: [{ type: "text", text: String(data.text ?? "") }],
    isError: Boolean(data.isError),
  });
};

/** 权威消息：优先按 toolCallId 精确替换（pi 默认并发执行工具，按「最后一个」会错位） */
export const mergeMessage = (items: ChatItem[], message: MessageDTO): ChatItem[] => {
  const { role } = message;

  if (role === "tool" && message.toolCallId) {
    const exact = items.findIndex((item) => item.id === `live-tool-${message.toolCallId}`);
    if (exact >= 0) return replaceAt(items, exact, { ...message, live: false });
  }

  if (role === "assistant" || role === "tool" || role === "user") {
    const index = lastLiveIndex(items, role);
    if (index >= 0) return replaceAt(items, index, { ...message, live: false });
  }

  return [...items, { ...message, live: false }];
};

/** 把本次运行测得的耗时挂到最后一条 assistant 消息上；没有则原样返回 */
export const attachAssistantTiming = (items: ChatItem[], timing: ChatItemTiming): ChatItem[] => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.role === "assistant") {
      const next = [...items];
      next[index] = { ...item, timing };
      return next;
    }
  }
  return items;
};

/** 一条 SSE 事件 → 新的消息列表 */
export const reduceEvent = (items: ChatItem[], event: string, payload: unknown): ChatItem[] => {
  const data = asRecord(payload);

  switch (event) {
    case "message_start":
      // 投影可能已经带着这条在途 assistant 消息，避免重复插入
      return data.role === "assistant" && lastLiveIndex(items, "assistant") < 0
        ? appendAssistantItem(items)
        : items;
    case "text_delta":
      return appendDelta(items, "text", String(data.delta ?? ""));
    case "thinking_delta":
      return appendDelta(items, "thinking", String(data.delta ?? ""));
    case "tool_call":
      return appendToolCall(items, {
        type: "toolCall",
        id: String(data.toolCallId ?? ""),
        name: String(data.toolName ?? "tool"),
        args: data.args,
      });
    case "tool_start":
      // 同一次调用声明重复到达时按 toolCallId 幂等，避免出现两张卡片
      return items.some((item) => item.id === `live-tool-${String(data.toolCallId ?? "")}`)
        ? items
        : startToolItem(items, data);
    case "tool_update":
    case "tool_end":
      return updateToolItem(items, data);
    case "message_end":
      return mergeMessage(items, payload as MessageDTO);
    default:
      return items;
  }
};
