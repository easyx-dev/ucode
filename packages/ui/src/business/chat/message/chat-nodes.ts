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
import type {
  CompactionRecord,
  GoalRecord,
  MessageBlock,
  PermissionRecord,
  QuestionItem,
} from "@ucode/contracts";
import {
  COMPACTION_RECORD_CUSTOM_TYPE,
  GOAL_PROMPT_CUSTOM_TYPE,
  GOAL_RECORD_CUSTOM_TYPE,
  PERMISSION_DECISION_CUSTOM_TYPE,
  PLAN_APPROVED_CUSTOM_TYPE,
  RETRY_RECORD_CUSTOM_TYPE,
  type RetryRecord,
  SKILL_RECORD_CUSTOM_TYPE,
} from "@ucode/contracts";
import type { ChatItem } from "../../../types";
import { itemText, uidOf } from "./chat-item";
import { buildGoalTurns, type GoalTurn } from "./goal-turns";
import { PRESENT_PLAN_TOOL } from "./plan";

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
  /** 工具产出的图片（如截图、读到的图片）；界面按附件路由取字节后内联展示 */
  images?: Extract<MessageBlock, { type: "image" }>[];
  /** 结果正文已被旧输出清理替换：模型不再看到它，但图片仍带在上面 */
  pruned?: boolean;
  /** 是否执行失败 */
  isError?: boolean;
  /** 是否仍在执行 */
  running?: boolean;
  /** 模型自行读到了某个技能（`SKILL_RECORD_CUSTOM_TYPE` 的 `hit` 记录），卡片上标出技能名 */
  skill?: { name: string };
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

/**
 * 一次写盘（`edit` / `write`）：独立成一卡片，展开看行级 diff，不并进聚合行。
 *
 * 聚合行把改动折进一句「使用了 2 个 编辑」，事后回看时看不出到底改了哪几行；而「改了什么」正是
 * 用户最常回看的内容。`write` 保持中性标题：pi 的 write 是 create-or-overwrite，区分不出新建与覆盖。
 */
type ChangeNode = {
  kind: "change";
  key: string;
  entry: ToolEntry;
  /** 发起这次调用的 assistant 消息 */
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
 * 一次上下文压缩：独立成段，界面渲染成「对话已压缩」分隔行 + 可展开的摘要。
 * 压缩会重写可见历史，这条摘要就是被替代掉的那段历史的唯一凭据，故不并进任何聚合行。
 *
 * `record` 是这一次压缩的触发与规模（`COMPACTION_RECORD_CUSTOM_TYPE` 条目）：摘要登在保留区间之前，
 * 而压缩真正发生在保留区间之后，两者并成一行后位置取记录（时间线上真实的那一点）；只有摘要（老会话）
 * 就按摘要位置渲染。
 */
type CompactionNode = {
  kind: "compaction";
  key: string;
  /** 摘要正文（pi 给出的结构化 markdown）；跳过 / 失败的记录没有摘要 */
  summary: string;
  /** 触发来源与规模；记录缺失（老会话）或记录不合法时为空 */
  record?: CompactionRecord;
};

/**
 * 一条合成输入（`custom_message`）：目标启动 / 续跑 / 恢复、计划批准。
 * 它不是用户打的字，只占一条细线，展开才看注入给模型的原文。
 */
type InjectedNode = {
  kind: "injected";
  key: string;
  item: ChatItem;
  text: string;
};

/**
 * 一次模型请求重试：一条细线。
 * 重试成功后不会再有后续记录（那一条不下发），所以界面上看到的就是「正在重试」与「重试到底仍失败」。
 */
type RetryNode = {
  kind: "retry";
  key: string;
  record: RetryRecord;
};

/** 目标跑完（校验通过）：一条细线，展开看校验结论 */
type GoalNode = {
  kind: "goal";
  key: string;
  record: GoalRecord;
};

/** 一轮目标执行：注入行与它那一轮的结论合成的一条分隔行 */
type GoalTurnNode = {
  kind: "goalTurn";
  key: string;
  turn: GoalTurn;
};

export type ChatNode =
  | ContentNode
  | ActivityNode
  | QuestionNode
  | ChangeNode
  | PermissionNode
  | CompactionNode
  | InjectedNode
  | GoalNode
  | GoalTurnNode
  | RetryNode;

/** 能承载轮页脚的节点：压缩、合成输入、目标完成与目标逐轮行都不是回答，没有「本轮模型与耗时」可报 */
type ChatFooterNode = Exclude<
  ChatNode,
  { kind: "compaction" | "injected" | "goal" | "goalTurn" | "retry" }
>;

type ToolCallBlock = Extract<MessageBlock, { type: "toolCall" }>;

/** assistant 消息内部的一段：思考 / 工具调用 / 提问 / 正文，按区块顺序切出 */
type AssistantLeg =
  | { kind: "thought"; key: string; text: string }
  | { kind: "tool"; key: string; entry: ToolEntry }
  | { kind: "change"; key: string; entry: ToolEntry }
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

/**
 * 写盘类工具：改动本身就是要看的东西，也独立成段（见 `tool/change-card`）。
 * 其余工具仍折进聚合行——一次轮次里几十次读 / 跑，逐条铺开会把回答挤出屏幕。
 */
const isChangeTool = (name: string): boolean => name === "edit" || name === "write";

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
  skillHits: Map<string, string>,
): ToolEntry => {
  const result = results.get(block.id);
  const skill = skillHits.get(block.id);
  const images = (result?.blocks ?? []).filter(
    (part): part is Extract<MessageBlock, { type: "image" }> => part.type === "image",
  );
  return {
    id: block.id,
    name: block.name,
    args: block.args,
    ...(skill ? { skill: { name: skill } } : {}),
    ...(result ? { result: itemText(result) } : {}),
    ...(images.length > 0 ? { images } : {}),
    ...(result?.pruned ? { pruned: true } : {}),
    isError: result?.isError === true,
    running: result ? Boolean(result.live) : Boolean(item.live),
  };
};

/**
 * 索引技能命中：`toolCallId` → 技能名。
 *
 * 必须预扫——命中条目排在 assistant 消息之后，主循环走到那次工具调用时还看不到它。
 */
const indexSkillHits = (items: ChatItem[]): Map<string, string> => {
  const hits = new Map<string, string>();
  for (const item of items) {
    if (item.customType !== SKILL_RECORD_CUSTOM_TYPE) continue;
    const record = item.skillRecord;
    if (record?.toolCallId) hits.set(record.toolCallId, record.name);
  }
  return hits;
};

/**
 * 按区块顺序把 assistant 消息切成段：思考与工具调用各自成段，其余区块（正文 / 图片 / 附件）连续合并。
 * 段 key 用「消息 id + 区块下标」，流式追加区块时已有段的 key 不变；`trailing` 标记消息的最后一段。
 */
const buildAssistantLegs = (
  item: ChatItem,
  results: Map<string, ChatItem>,
  skillHits: Map<string, string>,
): AssistantLeg[] => {
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
      // 写盘类工具的改动独立成卡片，不并进聚合行
      if (isChangeTool(block.name)) {
        legs.push({
          kind: "change",
          key: block.id,
          entry: toolEntryOf(item, block, results, skillHits),
        });
        return;
      }
      legs.push({
        kind: "tool",
        key: block.id,
        entry: toolEntryOf(item, block, results, skillHits),
      });
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

/** 把一段的段追加进节点列表：连续段续到末位聚合行，正文 / 提问 / 改动各自成节点 */
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

    if (leg.kind === "change") {
      nodes.push({ kind: "change", key: `change:${leg.key}`, entry: leg.entry, source: item });
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
  // 孤立的写盘结果没有入参、比不出 diff，留在聚合行里（有入参的那种见 `appendLegs` 的改动卡片）
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

/** 本条是不是压缩记录（`custom` 扩展条目之一） */
const compactionRecordOf = (item: ChatItem): CompactionRecord | undefined =>
  item.customType === COMPACTION_RECORD_CUSTOM_TYPE ? item.compactionRecord : undefined;

/** 本条是不是目标记录里要展示的那一条（校验结论与暂停原因只留在文件里） */
const goalCompletionOf = (item: ChatItem): GoalRecord | undefined =>
  item.customType === GOAL_RECORD_CUSTOM_TYPE && item.goalRecord?.event === "completed"
    ? item.goalRecord
    : undefined;

/** 合成输入：目标注入与计划批准，两者都是 `custom_message` */
const isInjected = (item: ChatItem): boolean =>
  item.customType === GOAL_PROMPT_CUSTOM_TYPE || item.customType === PLAN_APPROVED_CUSTOM_TYPE;

/** 摘要正文：列表里只会有最新那一条压缩条目（更早的被服务端过滤），没有就是空串 */
const summaryTextOf = (items: ChatItem[]): string => {
  const item = items.find((candidate) => candidate.role === "summary");
  return item ? itemText(item) : "";
};

export const buildChatNodes = (items: ChatItem[]): ChatNode[] => {
  const { results, callIds } = indexToolResults(items);
  const skillHits = indexSkillHits(items);
  // 目标注入与它那一轮的结论配对：配对上的注入行、结论行都并进同一条分隔行
  const goalTurns = buildGoalTurns(items);
  const goalTurnByKey = new Map(goalTurns.turns.map((turn) => [turn.key, turn]));
  const nodes: ChatNode[] = [];
  // 摘要挂到**最后一条**记录上：一次会话可能压过多次，只有最新那次配得上前面的摘要
  const lastRecord = [...items].reverse().find((item) => compactionRecordOf(item));
  const lastRecordUid = lastRecord ? uidOf(lastRecord) : null;
  for (const item of items) {
    if (item.role === "tool") {
      appendToolResult(nodes, item, callIds);
      continue;
    }
    if (item.role !== "assistant") {
      // 压缩摘要自成一段：它标出「此前历史已被替代」，当普通内容渲染会让人误以为是一轮回答
      if (item.role === "summary") {
        // 有压缩记录时，分隔行落在记录的位置（真正的压缩时刻），这里不重复渲染
        if (lastRecordUid === null) {
          nodes.push({ kind: "compaction", key: uidOf(item), summary: itemText(item) });
        }
        continue;
      }
      const record = compactionRecordOf(item);
      if (record) {
        const isNewest = uidOf(item) === lastRecordUid;
        nodes.push({
          kind: "compaction",
          key: uidOf(item),
          summary: isNewest ? summaryTextOf(items) : "",
          record,
        });
        continue;
      }
      // 合成输入自成一条细线：它是注入给模型的指令，不是用户发的消息；
      // 目标注入与它那一轮的结论配对时走逐轮分隔行，计划批准这类不配对
      if (isInjected(item)) {
        const turn = goalTurnByKey.get(uidOf(item));
        if (turn) {
          nodes.push({ kind: "goalTurn", key: `goalTurn:${turn.key}`, turn });
          continue;
        }
        nodes.push({ kind: "injected", key: uidOf(item), item, text: itemText(item) });
        continue;
      }
      // 技能记录不单独成行：标记已经挂到那次 `read` 的卡片上（见 `indexSkillHits`）
      if (item.customType === SKILL_RECORD_CUSTOM_TYPE) continue;
      // 重试记录自成一条细线：失败到重试之间用户否则只看到「什么都没发生」
      const retryRecord =
        item.customType === RETRY_RECORD_CUSTOM_TYPE ? item.retryRecord : undefined;
      if (retryRecord) {
        nodes.push({ kind: "retry", key: uidOf(item), record: retryRecord });
        continue;
      }
      // 其它目标记录（每轮校验、暂停原因）只留在会话文件里，不进消息区；
      // 已归轮的连「目标完成」那条也不再单独成行（并进了它那一轮的分隔行）
      if (item.customType === GOAL_RECORD_CUSTOM_TYPE) {
        if (goalTurns.consumed.has(uidOf(item))) continue;
        const completed = goalCompletionOf(item);
        if (completed) nodes.push({ kind: "goal", key: uidOf(item), record: completed });
        continue;
      }
      // 审批记录也自成一段：并进聚合行等于把它藏起来，而它恰恰是要回放给人看的
      const permission = permissionOf(item);
      if (permission) {
        nodes.push({ kind: "permission", key: uidOf(item), record: permission, source: item });
        continue;
      }
      nodes.push({ kind: "content", key: uidOf(item), item, blocks: item.blocks, trailing: true });
      continue;
    }

    // 还没吐任何区块的 assistant（包括思考被设置过滤掉的那种）不成行：
    // 生成中的提示由列表尾部的「工作中」一行给出
    const legs = buildAssistantLegs(item, results, skillHits);
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
    // 压缩、合成输入、目标逐轮行、目标完成与重试都不是回答，不参与轮末判定（拿它们当轮末会把页脚挂到细线上）
    if (
      node.kind === "compaction" ||
      node.kind === "injected" ||
      node.kind === "goal" ||
      node.kind === "goalTurn" ||
      node.kind === "retry"
    ) {
      continue;
    }
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
