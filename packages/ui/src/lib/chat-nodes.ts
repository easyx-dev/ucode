/**
 * 会话条目 → 渲染节点的投影。
 *
 * 把 assistant 消息里的 `toolCall` 区块与独立的 `role:"tool"` 结果按 `toolCallId` 配对成一次调用，
 * 并把相邻的连续调用合并成一个 `tools` 节点（跨多条 assistant 消息也能合，中间夹正文 / 思考才断开）；
 * 配对上的工具结果不再单独渲染。其余条目按内容段渲染，`trailing` 标记该段是否为来源消息的最后一段
 * （流式光标只挂在最后一段上）。一轮回复的页脚（模型 / 时间 / 耗时）只出现一次：通常挂在
 * 「该轮最后一条以正文结尾的 assistant 段」上，若该轮以工具调用收尾则挂到末位工具分组下方。
 */
import type { MessageBlock } from "@ucode/contracts";
import type { ChatItem } from "./types";

export type ToolEntry = {
  /** 工具调用 id，与结果消息的 `toolCallId` 对应 */
  id: string;
  /** 工具名 */
  name: string;
  /** 工具入参 */
  args?: unknown;
  /** 工具输出文本 */
  result?: string;
  /** 是否执行失败 */
  isError?: boolean;
  /** 是否仍在执行 */
  running?: boolean;
};

/** 一轮回复的页脚信息：模型 / 时间取自来源 assistant 消息，耗时由起止时间戳算出 */
export type ChatFooter = {
  item: ChatItem;
  durationMs?: number;
};

type ContentNode = {
  kind: "content";
  key: string;
  item: ChatItem;
  blocks: MessageBlock[];
  /** 是否为来源消息的最后一段 */
  trailing: boolean;
  /** 页脚是否挂在本段（每轮至多一处） */
  turnEnd: boolean;
  /** 本轮回复的总耗时（毫秒） */
  durationMs?: number;
};

type ToolsNode = { kind: "tools"; key: string; entries: ToolEntry[]; footer?: ChatFooter };

export type ChatNode = ContentNode | ToolsNode;

type ToolCallBlock = Extract<MessageBlock, { type: "toolCall" }>;

type AssistantSegment =
  | { type: "content"; blocks: MessageBlock[] }
  | { type: "tools"; entries: ToolEntry[] };

const itemText = (item: ChatItem): string =>
  item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");

/** ISO 时间 → 毫秒；缺失或非法返回 undefined */
const msOf = (iso?: string): number | undefined => {
  if (!iso) return undefined;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? undefined : value;
};

const contentNode = (
  key: string,
  item: ChatItem,
  blocks: MessageBlock[],
  trailing: boolean,
): ContentNode => ({ kind: "content", key, item, blocks, trailing, turnEnd: false });

/** 预先索引工具结果（供配对取输出）与所有调用 id（判断结果是否已被吸收） */
const indexToolResults = (
  items: ChatItem[],
): { results: Map<string, ChatItem>; callIds: Set<string> } => {
  const results = new Map<string, ChatItem>();
  const callIds = new Set<string>();
  for (const item of items) {
    if (item.role === "tool" && item.toolCallId) results.set(item.toolCallId, item);
    for (const block of item.blocks) {
      if (block.type === "toolCall") callIds.add(block.id);
    }
  }
  return { results, callIds };
};

const toolEntryOf = (
  item: ChatItem,
  block: ToolCallBlock,
  results: Map<string, ChatItem>,
): ToolEntry => {
  const result = results.get(block.id);
  return {
    id: block.id,
    name: block.name,
    args: block.args,
    ...(result ? { result: itemText(result) } : {}),
    isError: result?.isError === true,
    running: result ? Boolean(result.live) : Boolean(item.live),
  };
};

/** assistant 消息按「工具调用段 / 内容段」切开，连续的同类块各自成段 */
const segmentAssistant = (item: ChatItem, results: Map<string, ChatItem>): AssistantSegment[] => {
  const segments: AssistantSegment[] = [];
  for (const block of item.blocks) {
    if (block.type === "toolCall") {
      const entry = toolEntryOf(item, block, results);
      const last = segments[segments.length - 1];
      if (last?.type === "tools") last.entries.push(entry);
      else segments.push({ type: "tools", entries: [entry] });
    } else {
      const last = segments[segments.length - 1];
      if (last?.type === "content") last.blocks.push(block);
      else segments.push({ type: "content", blocks: [block] });
    }
  }
  return segments;
};

/** 相邻 tools 节点就地合并，实现「整轮连续调用」聚合 */
const appendTools = (nodes: ChatNode[], entries: ToolEntry[]): void => {
  if (entries.length === 0) return;
  const last = nodes[nodes.length - 1];
  if (last?.kind === "tools") {
    last.entries.push(...entries);
    return;
  }
  // 无自然 id 的兜底（正常调用 id 恒非空）：用当前节点数保证 key 不撞
  const first = entries[0];
  const key = first?.id ? `tools:${first.id}` : `tools:#${nodes.length}`;
  nodes.push({ kind: "tools", key, entries: [...entries] });
};

/** 未被任何 assistant 调用认领的工具结果（如历史被裁剪）：单独成一组工具节点 */
const appendToolResult = (nodes: ChatNode[], item: ChatItem, callIds: Set<string>): void => {
  if (item.toolCallId && callIds.has(item.toolCallId)) return;
  appendTools(nodes, [
    {
      id: item.toolCallId || item.id,
      name: item.toolName ?? "tool",
      result: itemText(item),
      isError: item.isError === true,
      running: Boolean(item.live),
    },
  ]);
};

const appendAssistant = (
  nodes: ChatNode[],
  item: ChatItem,
  results: Map<string, ChatItem>,
): void => {
  const segments = segmentAssistant(item, results);
  // 空 assistant（正文未到）保留一个内容节点，供尾部等待指示渲染
  if (segments.length === 0) {
    nodes.push(contentNode(item.id, item, [], true));
    return;
  }
  segments.forEach((segment, index) => {
    if (segment.type === "tools") appendTools(nodes, segment.entries);
    else
      nodes.push(
        contentNode(`${item.id}:${index}`, item, segment.blocks, index === segments.length - 1),
      );
  });
};

export const buildChatNodes = (items: ChatItem[]): ChatNode[] => {
  const { results, callIds } = indexToolResults(items);
  const nodes: ChatNode[] = [];
  for (const item of items) {
    if (item.role === "tool") appendToolResult(nodes, item, callIds);
    else if (item.role === "assistant") appendAssistant(nodes, item, results);
    else nodes.push(contentNode(item.id, item, item.blocks, true));
  }
  markTurnEnd(nodes);
  return nodes;
};

/**
 * 标记每轮回复的页脚位置并算出总耗时。
 *
 * 一轮 = 一条用户消息到下一轮用户消息之间。若该轮以工具调用收尾，页脚挂到末位工具分组下方；
 * 否则挂到「该轮最后一条以正文结尾的 assistant 段」上。
 */
const markTurnEnd = (nodes: ChatNode[]): void => {
  let turnStartMs: number | undefined;
  let lastTrailingIndex = -1;
  let lastNodeIndex = -1;
  let lastAssistant: ChatItem | undefined;
  let lastAssistantMs: number | undefined;

  const finalize = (): void => {
    const durationMs =
      turnStartMs !== undefined && lastAssistantMs !== undefined && lastAssistantMs >= turnStartMs
        ? lastAssistantMs - turnStartMs
        : undefined;
    const tail = nodes[lastNodeIndex];
    if (tail?.kind === "tools" && lastAssistant) {
      tail.footer = { item: lastAssistant, ...(durationMs !== undefined ? { durationMs } : {}) };
    } else {
      const node = nodes[lastTrailingIndex];
      if (node?.kind === "content") {
        node.turnEnd = true;
        if (durationMs !== undefined) node.durationMs = durationMs;
      }
    }
    lastTrailingIndex = -1;
    lastNodeIndex = -1;
    lastAssistant = undefined;
    lastAssistantMs = undefined;
  };

  nodes.forEach((node, index) => {
    if (node.kind === "content" && node.item.role === "user") {
      finalize();
      turnStartMs = msOf(node.item.createdAt);
      return;
    }
    lastNodeIndex = index;
    if (node.kind !== "content" || node.item.role !== "assistant") return;
    lastAssistant = node.item;
    lastAssistantMs = msOf(node.item.completedAt) ?? msOf(node.item.createdAt) ?? lastAssistantMs;
    if (node.trailing) lastTrailingIndex = index;
  });
  finalize();
};
