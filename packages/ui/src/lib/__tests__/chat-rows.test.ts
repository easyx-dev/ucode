/** 扁平行投影单测：工具配对、思考与工具的聚合、分轮与页脚归位、key 稳定性 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPACTION_RECORD_CUSTOM_TYPE,
  PERMISSION_DECISION_CUSTOM_TYPE,
  PLAN_IGNORED_CUSTOM_TYPE,
  SKILL_RECORD_CUSTOM_TYPE,
} from "@ucode/contracts";
import {
  buildChatRows,
  type ChatRow,
  compactionKeyOf,
  lastCompactionIndexOf,
  withoutThinking,
} from "../chat-rows";
import type { ChatItem, MessageBlock } from "../types";

const AT = "2026-01-01T10:00:00.000Z";

const text = (value: string): MessageBlock => ({ type: "text", text: value });
const thinking = (value: string): MessageBlock => ({ type: "thinking", text: value });
const call = (id: string, name: string): MessageBlock => ({ type: "toolCall", id, name, args: {} });

const userItem = (id: string, value: string): ChatItem => ({
  id,
  role: "user",
  blocks: [text(value)],
  createdAt: AT,
});

const assistantItem = (id: string, blocks: MessageBlock[], completedAt?: string): ChatItem => ({
  id,
  role: "assistant",
  blocks,
  createdAt: AT,
  ...(completedAt ? { completedAt } : {}),
});

const toolItem = (id: string, toolCallId: string, name: string, result: string): ChatItem => ({
  id,
  role: "tool",
  blocks: [text(result)],
  toolCallId,
  toolName: name,
  createdAt: AT,
});

/** question 调用：入参是结构化问题 */
const questionCall = (id: string, header: string, labels: string[]): MessageBlock => ({
  type: "toolCall",
  id,
  name: "question",
  args: {
    questions: [
      {
        header,
        question: `${header}？`,
        options: labels.map((label) => ({ label, description: `${label}的说明` })),
      },
    ],
  },
});

/** question 的结果：结构化答复挂在 `questionAnswers` 上 */
const questionResult = (id: string, toolCallId: string, answers: string[][]): ChatItem => ({
  ...toolItem(id, toolCallId, "question", "用户已回答"),
  questionAnswers: answers,
});

/** 审批记录：服务端落的 `custom` 扩展条目 */
const permissionItem = (
  id: string,
  decision: "allow_once" | "allow_session" | "deny",
): ChatItem => ({
  id,
  role: "custom",
  blocks: [],
  customType: PERMISSION_DECISION_CUSTOM_TYPE,
  permissionDecision: {
    tool: "bash",
    subject: "git push origin main",
    scope: "bash(git push *)",
    decision,
  },
  createdAt: AT,
});

/** 压缩记录：服务端落的 `custom` 扩展条目；摘要正文在配套的 `summary` 条目里 */
const compactionItem = (id: string): ChatItem => ({
  id,
  role: "custom",
  blocks: [],
  customType: COMPACTION_RECORD_CUSTOM_TYPE,
  compactionRecord: { reason: "threshold", outcome: "done", at: AT },
  createdAt: AT,
});

/** 技能命中记录：服务端落的 `custom` 扩展条目，`toolCallId` 指向读到技能文件的那次调用 */
const skillItem = (
  id: string,
  name: string,
  toolCallId: string,
  event: "hit" | "invoke" = "hit",
): ChatItem => ({
  id,
  role: "custom",
  blocks: [],
  customType: SKILL_RECORD_CUSTOM_TYPE,
  skillRecord: {
    event,
    name,
    file: `/skills/${name}/SKILL.md`,
    source: "project",
    ...(event === "hit" ? { toolCallId } : {}),
    at: AT,
  },
  createdAt: AT,
});

type RowOf<K extends ChatRow["kind"]> = Extract<ChatRow, { kind: K }>;

/** working 行不带节点也没有页脚，页脚断言据此收窄 */
type FooterRow = Exclude<ChatRow, { kind: "working" }>;

const rowsOfKind = <K extends ChatRow["kind"]>(rows: ChatRow[], kind: K): RowOf<K>[] =>
  rows.filter((row): row is RowOf<K> => row.kind === kind);

const kindsOf = (rows: ChatRow[]): string[] => rows.map((row) => row.kind);
const keysOf = (rows: ChatRow[]): string[] => rows.map((row) => row.key);

const footerRows = (rows: ChatRow[]): FooterRow[] =>
  rows.filter((row): row is FooterRow => row.kind !== "working" && row.footer !== undefined);

/** 聚合行里的段形态序列，如 `thought+tool+thought` */
const legsOf = (row: RowOf<"activity">): string =>
  row.node.legs.map((leg) => (leg.kind === "thought" ? "thought" : leg.entry.name)).join("+");

const entriesOf = (row: RowOf<"activity">): string[] =>
  row.node.legs.flatMap((leg) => (leg.kind === "tool" ? [leg.entry.id] : []));

describe("buildChatRows 的工具配对", () => {
  it("工具调用与结果按 toolCallId 配对，配对上的结果不单独成段", () => {
    const rows = buildChatRows([
      userItem("u1", "看看仓库"),
      assistantItem("a1", [call("c1", "bash")]),
      toolItem("t1", "c1", "bash", "输出"),
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "activity"]);
    const [activity] = rowsOfKind(rows, "activity");
    assert.deepEqual(entriesOf(activity!), ["c1"]);
    const leg = activity?.node.legs[0];
    assert.equal(leg?.kind === "tool" ? leg.entry.result : undefined, "输出");
  });

  it("没有对应调用的工具结果（历史被裁剪）自成一段", () => {
    const rows = buildChatRows([toolItem("t9", "c9", "ls", "a\nb")]);

    assert.deepEqual(kindsOf(rows), ["activity"]);
    assert.equal(rowsOfKind(rows, "activity")[0]?.key, "activity:c9");
  });
});

describe("buildChatRows 的聚合", () => {
  it("思考与工具调用合成一行，按原文顺序排列", () => {
    const rows = buildChatRows([
      userItem("u1", "问题"),
      assistantItem("a1", [thinking("想一下"), call("c1", "read"), thinking("再想想")]),
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "activity"]);
    assert.equal(legsOf(rowsOfKind(rows, "activity")[0]!), "thought+read+thought");
  });

  it("跨 assistant 消息的连续段也续在同一行里", () => {
    const rows = buildChatRows([
      userItem("u1", "问题"),
      assistantItem("a1", [thinking("想一下"), call("c1", "bash")]),
      toolItem("t1", "c1", "bash", "输出"),
      assistantItem("a2", [thinking("接着想"), call("c2", "edit")]),
      toolItem("t2", "c2", "edit", "改了"),
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "activity"]);
    assert.equal(legsOf(rowsOfKind(rows, "activity")[0]!), "thought+bash+thought+edit");
  });

  it("正文按定义打断聚合，切成三段独立的行", () => {
    const rows = buildChatRows([
      userItem("u1", "问题"),
      assistantItem("a1", [thinking("先想"), text("先看这里"), call("c1", "bash")]),
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "activity", "content", "activity"]);
    assert.equal(legsOf(rowsOfKind(rows, "activity")[0]!), "thought");
    assert.equal(legsOf(rowsOfKind(rows, "activity")[1]!), "bash");
  });

  it("图片与附件也算正文，同样打断聚合", () => {
    const rows = buildChatRows([
      userItem("u1", "问题"),
      assistantItem("a1", [
        call("c1", "bash"),
        { type: "image", id: "i1", mimeType: "image/png", url: "/api/v1/attachments/i1" },
        call("c2", "bash"),
      ]),
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "activity", "content", "activity"]);
  });

  it("整段只有一次调用时也成一行 activity，渲染层再决定是否省掉摘要", () => {
    const rows = buildChatRows([
      userItem("u1", "问题"),
      assistantItem("a1", [call("c1", "read"), call("c2", "read"), call("c3", "bash")]),
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "activity"]);
    assert.equal(legsOf(rowsOfKind(rows, "activity")[0]!), "read+read+bash");
  });
});

describe("buildChatRows 的分轮", () => {
  it("用户消息开启新轮：首行不开轮，后续轮首为 true", () => {
    const rows = buildChatRows([
      userItem("u1", "第一问"),
      assistantItem("a1", [text("第一答")]),
      userItem("u2", "第二问"),
      assistantItem("a2", [text("第二答")]),
    ]);

    assert.deepEqual(
      rows.map((row) => row.isTurnStart),
      [false, false, true, false],
    );
    assert.deepEqual(
      rows.map((row) => row.turnKey),
      ["u1", "u1", "u2", "u2"],
    );
  });

  it("首条用户消息之前的条目归入 turnKey 为空串的前置轮", () => {
    const rows = buildChatRows([
      assistantItem("a0", [text("被裁剪过的历史")]),
      userItem("u1", "问题"),
      assistantItem("a1", [text("回答")]),
    ]);

    assert.deepEqual(
      rows.map((row) => row.turnKey),
      ["", "u1", "u1"],
    );
    assert.deepEqual(
      rows.map((row) => row.isTurnStart),
      [false, true, false],
    );
  });
});

describe("buildChatRows 的页脚归位", () => {
  it("以正文结尾时页脚挂在正文段，并算出本轮耗时", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [text("答")], "2026-01-01T10:00:03.500Z"),
    ]);

    const footers = footerRows(rows);
    assert.equal(footers.length, 1);
    assert.equal(footers[0]?.key, "a1:c0");
    assert.equal(footers[0]?.footer?.item.id, "a1");
    assert.equal(footers[0]?.footer?.durationMs, 3500);
  });

  it("以工具调用收尾时页脚挂在末位聚合行，耗时用该条消息结算", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [text("先查"), call("c1", "bash")], "2026-01-01T10:00:08.000Z"),
      toolItem("t1", "c1", "bash", "输出"),
    ]);

    const footers = footerRows(rows);
    assert.equal(footers.length, 1);
    assert.equal(footers[0]?.kind, "activity");
    assert.equal(footers[0]?.footer?.item.id, "a1");
    assert.equal(footers[0]?.footer?.durationMs, 8000);
  });

  it("每轮页脚只出现在一行上", () => {
    const rows = buildChatRows([
      userItem("u1", "问一"),
      assistantItem("a1", [text("答一")]),
      userItem("u2", "问二"),
      assistantItem("a2", [text("答二"), call("c1", "read")]),
      toolItem("t1", "c1", "read", "内容"),
    ]);

    assert.deepEqual(
      footerRows(rows).map((row) => row.key),
      ["a1:c0", "activity:c1"],
    );
  });

  it("只有用户消息的轮次没有页脚", () => {
    const rows = buildChatRows([userItem("u1", "问")]);

    assert.deepEqual(kindsOf(rows), ["content"]);
    assert.equal(footerRows(rows).length, 0);
  });
  it("生成中那一轮没有页脚，已完成的轮次照旧有", () => {
    const rows = buildChatRows(
      [
        userItem("u1", "问一"),
        assistantItem("a1", [text("答一")]),
        userItem("u2", "问二"),
        assistantItem("a2", [text("答二")]),
      ],
      true,
    );

    assert.deepEqual(
      footerRows(rows).map((row) => row.turnKey),
      ["u1"],
    );
  });

  it("不生成时页脚照旧挂在每一轮末位", () => {
    const rows = buildChatRows([
      userItem("u1", "问一"),
      assistantItem("a1", [text("答一")]),
      userItem("u2", "问二"),
      assistantItem("a2", [text("答二")]),
    ]);

    assert.deepEqual(
      footerRows(rows).map((row) => row.turnKey),
      ["u1", "u2"],
    );
  });
});

describe("buildChatRows 的提问段", () => {
  it("提问独立成段：不并进聚合行，且带上结构化答复", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [
        thinking("想一下"),
        questionCall("q1", "落地方式", ["全部", "部分"]),
        call("c1", "bash"),
      ]),
      questionResult("t1", "q1", [["部分"]]),
      toolItem("t2", "c1", "bash", "输出"),
    ]);

    // 提问把两侧的聚合断成两组，自己占一段
    assert.deepEqual(kindsOf(rows), ["content", "activity", "question", "activity"]);
    const [before, after] = rowsOfKind(rows, "activity");
    assert.equal(legsOf(before!), "thought");
    assert.equal(legsOf(after!), "bash");

    const question = rowsOfKind(rows, "question")[0];
    assert.equal(question?.key, "question:q1");
    assert.equal(question?.node.settled, true);
    assert.deepEqual(
      question?.node.questions.map((item) => item.header),
      ["落地方式"],
    );
    assert.deepEqual(question?.node.answers, [["部分"]]);
  });

  it("未答复时仍算已结束（超时 / 取消也给了结果），不能与「还在等」混同", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [questionCall("q1", "确认", ["是"])]),
      toolItem("t1", "q1", "question", "提问超时：用户没有在限定时间内回答"),
    ]);

    const question = rowsOfKind(rows, "question")[0];
    assert.equal(question?.node.settled, true);
    assert.deepEqual(question?.node.answers, []);
  });

  it("结果未到时算「还在等」", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [questionCall("q1", "确认", ["是"])]),
    ]);

    const question = rowsOfKind(rows, "question")[0];
    assert.equal(question?.node.settled, false);
    assert.deepEqual(question?.node.answers, []);
    assert.equal(question?.node.questions.length, 1);
  });

  it("入参形状不对时丢掉该问题，不把非法字段透给渲染层", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [
        { type: "toolCall", id: "q1", name: "question", args: { questions: [{}, "x"] } },
      ]),
    ]);

    assert.deepEqual(rowsOfKind(rows, "question")[0]?.node.questions, []);
  });
});

describe("buildChatRows 的审批记录段", () => {
  it("审批记录独立成段，不并进聚合行", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [thinking("想一下"), call("c1", "bash")]),
      permissionItem("p1", "allow_once"),
      assistantItem("a2", [call("c2", "bash")]),
      toolItem("t1", "c1", "bash", "输出"),
      toolItem("t2", "c2", "bash", "输出"),
    ]);

    // 审批把两侧的聚合断成两组，自己占一段
    assert.deepEqual(kindsOf(rows), ["content", "activity", "permission", "activity"]);
    const [before, after] = rowsOfKind(rows, "activity");
    assert.equal(legsOf(before!), "thought+bash");
    assert.equal(legsOf(after!), "bash");

    const permission = rowsOfKind(rows, "permission")[0];
    assert.equal(permission?.key, "p1");
    assert.equal(permission?.node.record.decision, "allow_once");
    assert.equal(permission?.node.record.subject, "git push origin main");
  });

  it("普通扩展条目照旧当内容段渲染（如忽略计划标记）", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      {
        id: "x1",
        role: "custom",
        blocks: [],
        customType: PLAN_IGNORED_CUSTOM_TYPE,
        createdAt: AT,
      },
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "content"]);
  });
});

describe("buildChatRows 的 key 稳定性", () => {
  it("同一条 assistant 消息追加区块后原有行的 key 不变", () => {
    const question = userItem("u1", "问");
    const before = buildChatRows([
      question,
      assistantItem("a1", [text("先看看"), call("c1", "read")]),
    ]);
    const after = buildChatRows([
      question,
      assistantItem("a1", [text("先看看"), call("c1", "read"), text("答案")]),
    ]);

    assert.deepEqual(kindsOf(before), ["content", "content", "activity"]);
    assert.deepEqual(kindsOf(after), ["content", "content", "activity", "content"]);
    // 流式追加只该在尾部多出一行，已有行的 key 原样保留，否则虚拟列表会重建整屏
    assert.deepEqual(keysOf(after).slice(0, before.length), keysOf(before));
  });

  it("聚合行后续追加思考段时 key 取首段，不随增量变化", () => {
    const question = userItem("u1", "问");
    const before = buildChatRows([question, assistantItem("a1", [thinking("想一想")])]);
    const after = buildChatRows([
      question,
      assistantItem("a1", [thinking("想一想"), call("c1", "bash")]),
    ]);

    assert.equal(before[1]?.key, "activity:a1:t0");
    assert.equal(after[1]?.key, "activity:a1:t0");
  });

  it("落定时换成服务端 id，行 key 不变（否则会整行重建、闪一下）", () => {
    const question = { ...userItem("live-user-1", "问"), uid: "live-user-1" };
    const live = {
      ...assistantItem("live-assistant-1", [thinking("想一下"), call("c1", "bash")]),
      uid: "live-assistant-1",
    };
    const before = buildChatRows([question, live]);
    // message_end 会用服务端消息整体替掉乐观条目，uid 保留
    const settled: ChatItem[] = [
      { ...question, id: "m-user-1" },
      {
        ...assistantItem("m-a1", [thinking("想一下"), call("c1", "bash")]),
        uid: "live-assistant-1",
      },
    ];
    const after = buildChatRows(settled);

    assert.deepEqual(keysOf(after), keysOf(before));
    assert.deepEqual(
      after.map((row) => row.turnKey),
      before.map((row) => row.turnKey),
    );
    assert.equal(before[1]?.key, "activity:live-assistant-1:t0");
  });

  it("同一段正文追增量时行 key 也不变", () => {
    const question = userItem("u1", "问");
    const before = buildChatRows([question, assistantItem("a1", [text("半句")])]);
    const after = buildChatRows([question, assistantItem("a1", [text("半句补全")])]);

    assert.deepEqual(keysOf(after), keysOf(before));
  });
});

describe("buildChatRows 的最后一条用户消息", () => {
  it("只有最后一条用户行带 isLastUser 为真，之前的为假", () => {
    const rows = buildChatRows([
      userItem("u1", "第一问"),
      assistantItem("a1", [text("第一答")]),
      userItem("u2", "第二问"),
    ]);

    const users = rowsOfKind(rows, "content").filter((row) => row.node.item.role === "user");
    assert.deepEqual(
      users.map((row) => [row.key, row.isLastUser]),
      [
        ["u1", false],
        ["u2", true],
      ],
    );
  });

  it("assistant 内容行不带这个标记", () => {
    const rows = buildChatRows([userItem("u1", "问"), assistantItem("a1", [text("答")])]);

    assert.deepEqual(
      rowsOfKind(rows, "content").map((row) => row.isLastUser),
      [true, undefined],
    );
  });
});

describe("withoutThinking", () => {
  it("剔掉思考区块，其余区块与顺序不变", () => {
    const items = [
      userItem("u1", "问"),
      assistantItem("a1", [thinking("想想"), text("答"), thinking("再想想")]),
    ];

    const stripped = withoutThinking(items);
    assert.deepEqual(
      stripped.map((item) => item.blocks.map((block) => block.type)),
      [["text"], ["text"]],
    );
    assert.equal(items[1]?.blocks.length, 3);
  });

  it("全为思考的消息剔完就不成行，而不是留一个空内容行", () => {
    const question = userItem("u1", "问");
    const rows = buildChatRows(
      withoutThinking([question, assistantItem("a1", [thinking("只想了")])]),
    );

    assert.deepEqual(kindsOf(rows), ["content"]);
  });

  it("全为思考的 live 消息剔完不成行，生成中提示交给尾部的「工作中」", () => {
    const live = { ...assistantItem("a1", [thinking("想想")]), live: true };
    const rows = buildChatRows(withoutThinking([userItem("u1", "问"), live]), true);

    assert.deepEqual(kindsOf(rows), ["content", "working"]);
  });
});

describe("buildChatRows 的生成中行", () => {
  it("working 为真时在末尾追加一行，带上本轮提问时刻", () => {
    const rows = buildChatRows([userItem("u1", "问")], true);

    assert.equal(rows.length, 2);
    const last = rows.at(-1);
    assert.equal(last?.kind, "working");
    assert.equal(last?.key, "working");
    assert.equal(last?.turnKey, "u1");
    assert.equal(last?.isTurnStart, false);
    assert.equal(last?.kind === "working" ? last.startedAt : undefined, AT);
  });

  it("末位聚合行被标为正在进行（思考还在流也要出加载指示）", () => {
    const rows = buildChatRows(
      [userItem("u1", "问"), assistantItem("a1", [thinking("想一想")])],
      true,
    );

    const [activity] = rowsOfKind(rows, "activity");
    assert.equal(activity?.active, true);
  });

  it("生成中但不落在聚合行上时不标记（如末位是正文）", () => {
    const rows = buildChatRows([userItem("u1", "问"), assistantItem("a1", [text("在写了")])], true);

    assert.deepEqual(kindsOf(rows), ["content", "content", "working"]);
    assert.equal(rowsOfKind(rows, "activity").length, 0);
  });

  it("不在生成中时聚合行不带标记", () => {
    const rows = buildChatRows([userItem("u1", "问"), assistantItem("a1", [thinking("想完了")])]);

    assert.equal(rowsOfKind(rows, "activity")[0]?.active, undefined);
  });

  it("生成中行跟着最后一轮，取的是那条用户消息的时刻", () => {
    const rows = buildChatRows(
      [userItem("u1", "问一"), assistantItem("a1", [text("答一")]), userItem("u2", "问二")],
      true,
    );

    const last = rows.at(-1);
    assert.equal(last?.turnKey, "u2");
    assert.equal(last?.kind === "working" ? last.startedAt : undefined, AT);
  });

  it("列表为空时生成中行自成一行，turnKey 为空串且没有起点", () => {
    const rows = buildChatRows([], true);

    assert.deepEqual(kindsOf(rows), ["working"]);
    assert.equal(rows[0]?.turnKey, "");
    assert.equal(rows[0]?.kind === "working" ? rows[0].startedAt : "x", undefined);
  });

  it("working 为假时不追加", () => {
    assert.deepEqual(kindsOf(buildChatRows([userItem("u1", "问")])), ["content"]);
  });
});

describe("压缩分隔行的定位", () => {
  it("没有压缩过时没有定位（空与 -1）", () => {
    const rows = buildChatRows([userItem("u1", "问"), assistantItem("a1", [text("答")])]);

    assert.equal(compactionKeyOf(rows), null);
    assert.equal(lastCompactionIndexOf(rows), -1);
  });

  it("单条时指向它", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      compactionItem("c1"),
      assistantItem("a1", [text("答")]),
    ]);

    const index = lastCompactionIndexOf(rows);
    assert.equal(rows[index]?.kind, "compaction");
    assert.equal(compactionKeyOf(rows), rows[index]?.key);
  });

  it("压过多次时指向最后一条：视口该对到最近那次压缩", () => {
    const rows = buildChatRows([
      userItem("u1", "问一"),
      compactionItem("c1"),
      assistantItem("a1", [text("答一")]),
      compactionItem("c2"),
      assistantItem("a2", [text("答二")]),
    ]);

    const compactions = rowsOfKind(rows, "compaction");
    assert.equal(compactions.length, 2);
    assert.equal(compactionKeyOf(rows), compactions[1]?.key);
    assert.equal(lastCompactionIndexOf(rows), rows.indexOf(compactions[1]!));
  });

  it("旧数据只有摘要、没有记录时，照样定位到摘要那一行", () => {
    const rows = buildChatRows([
      { id: "s1", role: "summary", blocks: [text("早前的摘要")], createdAt: AT },
      userItem("u1", "问"),
      assistantItem("a1", [text("答")]),
    ]);

    assert.equal(rows[lastCompactionIndexOf(rows)]?.kind, "compaction");
    assert.equal(compactionKeyOf(rows), "s1");
  });
});

describe("技能命中记录", () => {
  it("不单独成行，标记挂到读到技能文件的那次调用上", () => {
    const rows = buildChatRows([
      userItem("u1", "用它看看"),
      assistantItem("a1", [call("c1", "read")]),
      toolItem("t1", "c1", "read", "技能正文"),
      skillItem("s1", "lark-base", "c1"),
    ]);

    assert.deepEqual(kindsOf(rows), ["content", "activity"]);
    const leg = rowsOfKind(rows, "activity")[0]?.node.legs[0];
    assert.equal(leg?.kind === "tool" ? leg.entry.skill?.name : undefined, "lark-base");
  });

  it("孤儿命中（那次调用不在当前分支）不产生任何行", () => {
    const rows = buildChatRows([userItem("u1", "问"), skillItem("s1", "lark-base", "c-缺失")]);

    assert.deepEqual(kindsOf(rows), ["content"]);
  });

  it("显式调用（invoke）没有可挂的调用，同样不成行", () => {
    const rows = buildChatRows([
      userItem("u1", "问"),
      assistantItem("a1", [call("c1", "read")]),
      toolItem("t1", "c1", "read", "技能正文"),
      skillItem("s1", "review", "c1", "invoke"),
    ]);

    const leg = rowsOfKind(rows, "activity")[0]?.node.legs[0];
    assert.equal(leg?.kind === "tool" ? leg.entry.skill : undefined, undefined);
  });
});
