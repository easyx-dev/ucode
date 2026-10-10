/**
 * 渲染节点 → 虚拟列表的扁平行投影。
 *
 * 一轮回复可能高达成千上万像素（长正文、几十次工具调用），按轮虚拟化等于没虚拟化，所以这里把节点摊成
 * 「一行一个节点」，交给虚拟列表按行测量与回收。行的 key 直接取自节点的稳定 key（同一条 assistant 消息
 * 流式追加区块时已有行的 key 不变），节点上的 `footer` 原样带到行上。
 */
import { uidOf } from "./chat-item";
import { buildChatNodes, type ChatFooter, type ChatNode } from "./chat-nodes";
import type { ChatItem } from "./types";

type ContentNode = Extract<ChatNode, { kind: "content" }>;
type ActivityNode = Extract<ChatNode, { kind: "activity" }>;
type QuestionNode = Extract<ChatNode, { kind: "question" }>;
type PermissionNode = Extract<ChatNode, { kind: "permission" }>;
type CompactionNode = Extract<ChatNode, { kind: "compaction" }>;
type InjectedNode = Extract<ChatNode, { kind: "injected" }>;
type GoalNode = Extract<ChatNode, { kind: "goal" }>;
type GoalTurnNode = Extract<ChatNode, { kind: "goalTurn" }>;
type RetryNode = Extract<ChatNode, { kind: "retry" }>;

type ChatRowBase = {
  /** 虚拟列表稳定 key，跨流式增量必须不变 */
  key: string;
  /** 所属轮（用户消息的界面标识；首条用户消息之前的前置轮为空串） */
  turnKey: string;
  /** 是否开启新一轮，决定行首间距分档 */
  isTurnStart: boolean;
  /** 该轮页脚挂在这一行上（每轮至多一处） */
  footer?: ChatFooter;
};

/** 正文行：用户消息或 assistant 的正文 / 图片 / 附件段 */
export type ChatContentRow = ChatRowBase & {
  kind: "content";
  node: ContentNode;
  /** 是否为最后一条用户消息（编辑它会移除其后内容，界面据此提示）；仅用户行有值 */
  isLastUser?: boolean;
};

/** 聚合行：连续的思考与工具调用折成的一行 */
export type ChatActivityRow = ChatRowBase & {
  kind: "activity";
  node: ActivityNode;
  /** 这一组正是本轮正在处理的那一组（思考还在流 / 有工具在跑），行尾要出加载指示 */
  active?: boolean;
};

/** 提问行：一次提问与用户的答复，独立成段（不并进聚合行） */
export type ChatQuestionRow = ChatRowBase & { kind: "question"; node: QuestionNode };

/** 审批记录行：一次权限确认的对象与结论，独立成段（不并进聚合行） */
export type ChatPermissionRow = ChatRowBase & { kind: "permission"; node: PermissionNode };

/** 压缩分隔行：标出「此前的历史已被摘要替代」，摘要可展开回看 */
export type ChatCompactionRow = ChatRowBase & { kind: "compaction"; node: CompactionNode };

/** 合成输入行：目标启动 / 续跑 / 恢复、计划批准，只占一条细线 */
export type ChatInjectedRow = ChatRowBase & { kind: "injected"; node: InjectedNode };

/** 重试细线行：模型请求失败到重试之间的一条分隔线 */
export type ChatRetryRow = ChatRowBase & { kind: "retry"; node: RetryNode };

/** 目标完成行：一条细线，展开看校验结论 */
export type ChatGoalRow = ChatRowBase & { kind: "goal"; node: GoalNode };

/** 目标逐轮行：一次注入与它那一轮的结论合成的一条细线 */
export type ChatGoalTurnRow = ChatRowBase & { kind: "goalTurn"; node: GoalTurnNode };

/** 尾部的生成中行：列表最后一道提示，带本轮的实时耗时，没有对应节点也不承载页脚 */
export type ChatWorkingRow = Omit<ChatRowBase, "footer"> & {
  kind: "working";
  isTurnStart: false;
  /** 本轮提问的时刻，用来实时算已工作时长 */
  startedAt?: string;
};

export type ChatRow =
  | ChatContentRow
  | ChatActivityRow
  | ChatQuestionRow
  | ChatPermissionRow
  | ChatCompactionRow
  | ChatInjectedRow
  | ChatGoalRow
  | ChatGoalTurnRow
  | ChatRetryRow
  | ChatWorkingRow;

const WORKING_ROW_KEY = "working";

const rowOfNode = (
  node: ChatNode,
  turnKey: string,
  isTurnStart: boolean,
  /** 生成中的那一轮不报模型与耗时，由调用方置 false */
  withFooter: boolean,
): ChatRow => {
  // 压缩、合成输入与目标完成都不是回答，没有「这一轮的模型与耗时」可挂，也不参与轮末判定
  if (node.kind === "compaction") {
    return { kind: "compaction", key: node.key, turnKey, isTurnStart, node };
  }
  if (node.kind === "injected") {
    return { kind: "injected", key: node.key, turnKey, isTurnStart, node };
  }
  if (node.kind === "goal") {
    return { kind: "goal", key: node.key, turnKey, isTurnStart, node };
  }
  if (node.kind === "goalTurn") {
    return { kind: "goalTurn", key: node.key, turnKey, isTurnStart, node };
  }
  if (node.kind === "retry") {
    return { kind: "retry", key: node.key, turnKey, isTurnStart, node };
  }
  const base: ChatRowBase = {
    key: node.key,
    turnKey,
    isTurnStart,
    ...(withFooter && node.footer ? { footer: node.footer } : {}),
  };
  if (node.kind === "content") return { ...base, kind: "content", node };
  if (node.kind === "activity") return { ...base, kind: "activity", node };
  if (node.kind === "question") return { ...base, kind: "question", node };
  return { ...base, kind: "permission", node };
};

/** 生成中行跟着当前轮末尾；一轮都还没开始时 turnKey 为空串 */
const workingRow = (turnKey: string, startedAt?: string): ChatWorkingRow => ({
  kind: "working",
  key: WORKING_ROW_KEY,
  turnKey,
  isTurnStart: false,
  ...(startedAt ? { startedAt } : {}),
});

/** 最后一轮的用户标识：生成中的就是它那一轮 */
const lastUserIdOf = (items: ChatItem[]): string | undefined => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.role === "user") return uidOf(item);
  }
  return undefined;
};

/**
 * 条目 → 扁平行。
 *
 * 用户消息自成一行并开启新轮；首条用户消息之前若有 assistant / tool 条目（历史被裁剪），归入 turnKey
 * 为空串的前置轮。`rows[0].isTurnStart` 恒为 false —— 列表顶部的间距由容器负责（虚拟列表的
 * `paddingStart`、嵌套容器自身的内边距）。
 *
 * `working` 为真时除了在尾部加一行生成中提示，还会拿掉「当前这一轮」的页脚：页脚的模型与耗时要等这轮
 * 落定才准。不能靠条目的 `live` 标记判断——流式投影里它只在 `liveMessageId` 对得上时才置位。
 */
export const buildChatRows = (items: ChatItem[], working?: boolean): ChatRow[] => {
  const rows: ChatRow[] = [];
  const activeTurnKey = working ? lastUserIdOf(items) : undefined;
  let turnKey = "";
  let turnStartedAt: string | undefined;
  let lastUserIndex = -1;
  for (const node of buildChatNodes(items)) {
    const opensTurn = node.kind === "content" && node.item.role === "user";
    if (opensTurn) {
      turnKey = uidOf(node.item);
      turnStartedAt = node.item.createdAt;
      lastUserIndex = rows.length;
    }
    rows.push(rowOfNode(node, turnKey, opensTurn && rows.length > 0, turnKey !== activeTurnKey));
  }

  rows.forEach((row, index) => {
    if (row.kind === "content" && row.node.item.role === "user") {
      rows[index] = { ...row, isLastUser: index === lastUserIndex };
    }
  });

  if (working) {
    // 本轮正在处理的是末位聚合行：思考还在流（不一定是工具在跑）时也要出加载指示
    const tail = rows[rows.length - 1];
    if (tail?.kind === "activity") rows[rows.length - 1] = { ...tail, active: true };
    rows.push(workingRow(turnKey, turnStartedAt));
  }
  return rows;
};

/**
 * 最后一条压缩分隔行的下标；没有压缩过时为 -1。
 *
 * 取最后一条而不是第一条：一次会话可能被压缩多次，历史里留着多条分隔行，视口该对到最近的那次。
 */
export const lastCompactionIndexOf = (rows: readonly ChatRow[]): number => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.kind === "compaction") return index;
  }
  return -1;
};

/** 最后一条压缩分隔行的 key；没有压缩过时为 null */
export const compactionKeyOf = (rows: readonly ChatRow[]): string | null => {
  const index = lastCompactionIndexOf(rows);
  return index < 0 ? null : (rows[index]?.key ?? null);
};

/**
 * 去掉思考区块，供「不展示思考过程」时使用。
 *
 * 在这一层而不是在组件里过滤：只留一个没有区块的内容行会白占一段行首间距，而全为思考的消息剔完就没有段，
 * 不会成行。
 */
export const withoutThinking = (items: ChatItem[]): ChatItem[] =>
  items.map((item) =>
    item.blocks.some((block) => block.type === "thinking")
      ? { ...item, blocks: item.blocks.filter((block) => block.type !== "thinking") }
      : item,
  );
