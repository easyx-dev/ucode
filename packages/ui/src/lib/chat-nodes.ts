/**
 * 会话条目 → 渲染节点的投影。
 *
 * 把 assistant 消息里的 `toolCall` 区块与独立的 `role:"tool"` 结果按 `toolCallId` 配对成一次调用。
 * 思考区块与工具调用按原文顺序抽成「段」（`ChatLeg`），**连续的段合成一个 `activity` 节点**——
 * 一段回复里动辄几十次「想一下、调一次工具」，逐条铺开会把真正的回答挤出屏幕；界面上它只占一行摘要
 * （「思考了 3 次，使用了 2 个 运行、1 个 编辑」），展开才逐段回看。正文 / 图片 / 附件是 `content` 节点，
 * 它按定义打断 activity 的连续段。
 *
 * 一轮回复的页脚（模型 / 时间 / 耗时）只出现一次，挂在该轮末位节点上；`source` 记的是最后一条贡献内容的
 * assistant 消息，页脚的模型与耗时靠它，孤儿工具结果（调用记录已被裁剪）没有来源。
 *
 * `present_plan` 是给界面判断「本轮以计划收尾」的内部信号，不是给用户看的工作产物，故它的调用与结果
 * 都在这一层就去掉（判定表单直接扫条目，见 `plan.ts`；统计与折叠也因此看不到它）。
 */
import type { MessageBlock, PermissionRecord, QuestionItem } from "@ucode/contracts";
import { PERMISSION_DECISION_CUSTOM_TYPE } from "@ucode/contracts";
import { PRESENT_PLAN_TOOL } from "./plan";
import type { ChatItem } from "./types";

/** 一次工具调用：调用区块与它的结果已经配好对 */
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
  /** 本轮从提问到生成结束的耗时（毫秒） */
  durationMs?: number;
};

/** 聚合行里的一段：一段思考或一次工具调用，按原文顺序排列 */
export type ChatLeg =
  | { kind: "thought"; key: string; text: string; item: ChatItem }
  | { kind: "tool"; key: string; entry: ToolEntry };

type ContentNode = {
  kind: "content";
  key: string;
  item: ChatItem;
  blocks: MessageBlock[];
  /** 是否为来源消息的最后一段（流式光标只挂在最后一段上） */
  trailing: boolean;
  footer?: ChatFooter;
};

/** 连续的思考与工具调用合成的聚合行 */
type ActivityNode = {
  kind: "activity";
  key: string;
  /** 该组里的段，按原文顺序 */
  legs: ChatLeg[];
  /** 最后一条贡献内容的 assistant 消息 */
  source?: ChatItem;
  footer?: ChatFooter;
};

/** 一次提问及其答复：独立成段，不并进聚合行 */
type QuestionNode = {
  kind: "question";
  key: string;
  /** 提问内容；`answers` 与它同序，未答复时为空 */
  questions: QuestionItem[];
  answers: string[][];
  /** 是否已有结果：本轮被中断取消也算有结果，但答复为空，不能与「还在等」混为一谈 */
  settled: boolean;
  /** 发起提问的 assistant 消息 */
  source?: ChatItem;
  footer?: ChatFooter;
};

/** 一次权限审批记录：独立成段，不并进聚合行 */
type PermissionNode = {
  kind: "permission";
  key: string;
  /** 审批对象与结论 */
  record: PermissionRecord;
  /** 这条记录自身的条目，页脚要用它的时刻 */
  source?: ChatItem;
  footer?: ChatFooter;
};

/**
 * 一次上下文压缩：独立成段，界面渲染成「会话已压缩」分隔行 + 可展开的摘要。
 * 压缩会重写可见历史，这条摘要就是被替代掉的那段历史的唯一凭据，故不并进任何聚合行。
 */
type CompactionNode = {
  kind: "compaction";
  key: string;
  /** 摘要正文（pi 给出的结构化 markdown） */
  summary: string;
};

export type ChatNode = ContentNode | ActivityNode | QuestionNode | PermissionNode | CompactionNode;

/** 能承载轮页脚的节点：压缩分隔行不是回答，没有「本轮模型与耗时」可报 */
type ChatFooterNode = Exclude<ChatNode, { kind: "compaction" }>;

type ToolCallBlock = Extract<MessageBlock, { type: "toolCall" }>;

/** assistant 消息内部的一段：思考 / 工具调用 / 提问 / 正文，按区块顺序切出 */
type AssistantLeg =
  | { kind: "thought"; key: string; text: string }
  | { kind: "tool"; key: string; entry: ToolEntry }
  | {
      kind: "question";
      key: string;
      questions: QuestionItem[];
      answers: string[][];
      settled: boolean;
    }
  | { kind: "content"; key: string; blocks: MessageBlock[]; trailing: boolean };

/** 交互式提问的工具名：它自己成段展示（含答复），不并进聚合行 */
const QUESTION_TOOL = "question";

/** 入参来自模型，形状不可信：逐项挑出合法字段，缺 header / question 的条目直接丢弃 */
const questionItemsOf = (args: unknown): QuestionItem[] => {
  const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  if (!Array.isArray(record.questions)) return [];
  return record.questions.flatMap((entry) => {
    const item =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
    if (typeof item.header !== "string" || typeof item.question !== "string") return [];
    const options = Array.isArray(item.options) ? item.options : [];
    return [
      {
        header: item.header,
        question: item.question,
        options: options.flatMap((option) => {
          const one =
            typeof option === "object" && option !== null
              ? (option as Record<string, unknown>)
              : {};
          return typeof one.label === "string"
            ? [
                {
                  label: one.label,
                  description: typeof one.description === "string" ? one.description : "",
                },
              ]
            : [];
        }),
        ...(item.multiple === true ? { multiple: true } : {}),
      },
    ];
  });
};

const itemText = (item: ChatItem): string =>
  item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");

/**
 * 行 key 与轮标识的来源：`uid` 跨「乐观条目 → 权威条目」不变，而 `id` 会在 `message_end` 换成服务端 id。
 * 拿 `id` 当 key 的话，每次落定都会把整行卸载重建——生成中看得到的闪一下。
 */
export const uidOf = (item: ChatItem): string => item.uid ?? item.id;

/** ISO 时间 → 毫秒；缺失或非法返回 undefined */
const msOf = (iso?: string): number | undefined => {
  if (!iso) return undefined;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? undefined : value;
};

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

/**
 * 按区块顺序把 assistant 消息切成段：思考与工具调用各自成段，其余区块（正文 / 图片 / 附件）连续合并。
 * 段 key 用「消息 id + 区块下标」，流式追加区块时已有段的 key 不变；`trailing` 标记消息的最后一段。
 */
const buildAssistantLegs = (item: ChatItem, results: Map<string, ChatItem>): AssistantLeg[] => {
  const legs: AssistantLeg[] = [];
  item.blocks.forEach((block, index) => {
    if (block.type === "toolCall") {
      // 收尾信号不成段：它与它的结果都不进消息区
      if (block.name === PRESENT_PLAN_TOOL) return;
      // 提问要带着答复单独成段：并进聚合行的话，用户事后看不到自己到底答了什么
      if (block.name === QUESTION_TOOL) {
        const result = results.get(block.id);
        legs.push({
          kind: "question",
          key: block.id,
          questions: questionItemsOf(block.args),
          answers: result?.questionAnswers ?? [],
          settled: result !== undefined,
        });
        return;
      }
      legs.push({ kind: "tool", key: block.id, entry: toolEntryOf(item, block, results) });
      return;
    }
    if (block.type === "thinking") {
      legs.push({ kind: "thought", key: `${uidOf(item)}:t${index}`, text: block.text });
      return;
    }
    const last = legs[legs.length - 1];
    if (last?.kind === "content") last.blocks.push(block);
    else
      legs.push({
        kind: "content",
        key: `${uidOf(item)}:c${index}`,
        blocks: [block],
        trailing: false,
      });
  });

  const tail = legs[legs.length - 1];
  if (tail?.kind === "content") tail.trailing = true;
  return legs;
};

/** 把一段的段追加进节点列表：连续段续到末位聚合行，正文与提问各自成节点 */
const appendLegs = (nodes: ChatNode[], legs: AssistantLeg[], item: ChatItem): void => {
  for (const leg of legs) {
    if (leg.kind === "content") {
      nodes.push({
        kind: "content",
        key: leg.key,
        item,
        blocks: leg.blocks,
        trailing: leg.trailing,
      });
      continue;
    }

    if (leg.kind === "question") {
      nodes.push({
        kind: "question",
        key: `question:${leg.key}`,
        questions: leg.questions,
        answers: leg.answers,
        settled: leg.settled,
        source: item,
      });
      continue;
    }

    const chatLeg: ChatLeg =
      leg.kind === "thought"
        ? { kind: "thought", key: leg.key, text: leg.text, item }
        : { kind: "tool", key: leg.key, entry: leg.entry };
    const last = nodes[nodes.length - 1];
    if (last?.kind === "activity") {
      last.legs.push(chatLeg);
      last.source = item;
      continue;
    }
    // key 取首段的 key：后续段只往组里追加，行 key 因此不随流式增量变化
    nodes.push({ kind: "activity", key: `activity:${leg.key}`, legs: [chatLeg], source: item });
  }
};

/** 未被任何 assistant 调用认领的工具结果（如历史被裁剪）：单独成一段 */
const appendToolResult = (nodes: ChatNode[], item: ChatItem, callIds: Set<string>): void => {
  if (item.toolCallId && callIds.has(item.toolCallId)) return;
  // 调用被裁剪出上下文而结果还在时同样不成段
  if (item.toolName === PRESENT_PLAN_TOOL) return;
  const entry: ToolEntry = {
    id: item.toolCallId || uidOf(item),
    name: item.toolName ?? "tool",
    result: itemText(item),
    isError: item.isError === true,
    running: Boolean(item.live),
  };
  const last = nodes[nodes.length - 1];
  if (last?.kind === "activity") last.legs.push({ kind: "tool", key: entry.id, entry });
  else
    nodes.push({
      kind: "activity",
      key: `activity:${entry.id}`,
      legs: [{ kind: "tool", key: entry.id, entry }],
    });
};

/** 本条是不是权限审批记录（`custom` 扩展条目之一） */
const permissionOf = (item: ChatItem): PermissionRecord | undefined =>
  item.customType === PERMISSION_DECISION_CUSTOM_TYPE ? item.permissionDecision : undefined;

export const buildChatNodes = (items: ChatItem[]): ChatNode[] => {
  const { results, callIds } = indexToolResults(items);
  const nodes: ChatNode[] = [];
  for (const item of items) {
    if (item.role === "tool") {
      appendToolResult(nodes, item, callIds);
      continue;
    }
    if (item.role !== "assistant") {
      // 压缩摘要自成一段：它标出「此前历史已被替代」，当普通内容渲染会让人误以为是一轮回答
      if (item.role === "summary") {
        nodes.push({ kind: "compaction", key: uidOf(item), summary: itemText(item) });
        continue;
      }
      // 审批记录也自成一段：并进聚合行等于把它藏起来，而它恰恰是要回放给人看的
      const record = permissionOf(item);
      if (record) {
        nodes.push({ kind: "permission", key: uidOf(item), record, source: item });
        continue;
      }
      nodes.push({ kind: "content", key: uidOf(item), item, blocks: item.blocks, trailing: true });
      continue;
    }

    // 还没吐任何区块的 assistant（包括思考被设置过滤掉的那种）不成行：
    // 生成中的提示由列表尾部的「工作中」一行给出
    const legs = buildAssistantLegs(item, results);
    if (legs.length > 0) appendLegs(nodes, legs, item);
  }
  markTurnEnd(nodes);
  return nodes;
};

/**
 * 标记每轮回复的页脚位置并算出总耗时。
 *
 * 一轮 = 一条用户消息到下一轮用户消息之间，页脚挂在该轮的末位节点上——末位是正文段就落在正文下，
 * 是聚合行就落在聚合行下。压缩分隔行不属于任何一轮（它不是回答，也没有本轮耗时），既不挂页脚也不占轮末位置。
 */
const markTurnEnd = (nodes: ChatNode[]): void => {
  let turnStartMs: number | undefined;
  let last: ChatFooterNode | undefined;
  let owner: ChatItem | undefined;
  let ownerMs: number | undefined;

  const finalize = (): void => {
    if (last && owner) {
      const durationMs =
        turnStartMs !== undefined && ownerMs !== undefined && ownerMs >= turnStartMs
          ? ownerMs - turnStartMs
          : undefined;
      last.footer = { item: owner, ...(durationMs !== undefined ? { durationMs } : {}) };
    }
    last = undefined;
    owner = undefined;
    ownerMs = undefined;
  };

  for (const node of nodes) {
    if (node.kind === "content" && node.item.role === "user") {
      finalize();
      turnStartMs = msOf(node.item.createdAt);
      continue;
    }
    if (node.kind === "compaction") continue;
    last = node;
    // 聚合行与提问节点自身没有正文段，它携带的 `source` 才是页脚要用的那条 assistant 消息
    const source =
      node.kind === "content"
        ? node.item.role === "assistant"
          ? node.item
          : undefined
        : node.source;
    if (!source) continue;
    owner = source;
    ownerMs = msOf(source.completedAt) ?? msOf(source.createdAt) ?? ownerMs;
  }
  finalize();
};
