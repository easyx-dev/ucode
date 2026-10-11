/** question 工具单测：答复折成给模型的文本，取消给出可读错误，参数 schema 挡掉空提问（Q-01） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QuestionItem } from "@ucode/contracts";
import { Value } from "typebox/value";

import type { QuestionAnswerResult } from "../../../../core/interactions";
import { createQuestionTool } from "../question";

const questions: QuestionItem[] = [
  {
    header: "发布分支",
    question: "从哪个分支发布？",
    options: [
      { label: "main", description: "稳定分支" },
      { label: "staging", description: "预发分支" },
    ],
  },
];

const run = async (result: QuestionAnswerResult) => {
  const tool = createQuestionTool({ ask: async () => result });
  const ctx = {} as Parameters<typeof tool.execute>[4];
  return tool.execute("call-1", { questions }, undefined, undefined, ctx);
};

describe("createQuestionTool", () => {
  it("把用户答复折成可读文本", async () => {
    const output = await run({ kind: "answered", answers: [["staging"]] });
    const text = output.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    assert.ok(text.includes("用户已回答"), text);
    assert.ok(text.includes("staging"), text);
  });

  it("跳过的回答显式标注", async () => {
    const output = await run({ kind: "answered", answers: [[]] });
    const text = output.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    assert.ok(text.includes("用户跳过"), text);
  });

  it("取消抛可读错误", async () => {
    await assert.rejects(() => run({ kind: "cancelled" }), /提问已取消/);
  });

  it("参数 schema 不接受空提问：一个都不问就挂起，界面只剩一层盖住输入区的空面板", () => {
    const tool = createQuestionTool({ ask: async () => ({ kind: "cancelled" }) });
    assert.equal(Value.Check(tool.parameters, { questions: [] }), false);
    assert.equal(Value.Check(tool.parameters, { questions }), true);
  });
});
