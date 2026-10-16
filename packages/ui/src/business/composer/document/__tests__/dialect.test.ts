/** 输入区「文档 → 方言 → 载荷」的装配单测：阻断项与技能占用提示 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DocNode } from "@ucode/markdown";

import { type CommandAssets, payloadOfDoc } from "../dialect";

const commands: CommandAssets = {
  prompts: [
    { name: "todo", description: "记待办", bytes: 120, source: "builtin" },
    { name: "review", description: "审查", bytes: 200, source: "builtin" },
  ],
  skills: [
    { name: "pdf", description: "PDF", bytes: 2048, source: "global" },
    { name: "typescript", description: "TS", bytes: 1024, source: "global" },
  ],
};

const docOf = (lines: readonly string[]): DocNode => ({
  type: "doc",
  content: lines.map((line) => ({
    type: "paragraph",
    ...(line ? { content: [{ type: "text", text: line }] } : {}),
  })),
});

describe("payloadOfDoc", () => {
  it("容器解析成命令 / 技能，并算出注入体积", () => {
    const { payload, skillCost, blocking } = payloadOfDoc(
      docOf([":::command[todo]", "记一条", ":::", "", ":::skill[pdf]", "生成报告", ":::"]),
      commands,
    );

    assert.deepEqual(payload.command, { name: "todo", args: "记一条" });
    assert.deepEqual(payload.skills, [{ name: "pdf", args: "生成报告" }]);
    assert.deepEqual(skillCost, { count: 1, bytes: 2048 });
    assert.deepEqual(blocking, []);
  });

  it("多条技能把体积累加（提示用）", () => {
    const { skillCost } = payloadOfDoc(
      docOf([":::skill[pdf]", "一", ":::", "", ":::skill[typescript]", "二", ":::"]),
      commands,
    );

    assert.deepEqual(skillCost, { count: 2, bytes: 3072 });
  });

  it("名字不在清单时进阻断项，仍保留结构化结果", () => {
    const { blocking } = payloadOfDoc(docOf([":::command[nope]", "参数", ":::"]), commands);

    assert.deepEqual(
      blocking.map((item) => item.code),
      ["command-unknown"],
    );
  });

  it("手打的 `/名字 参数` 与容器等效", () => {
    const { payload, blocking } = payloadOfDoc(docOf(["/review 改动 a.ts"]), commands);

    assert.deepEqual(payload.command, { name: "review", args: "改动 a.ts" });
    assert.deepEqual(blocking, []);
  });
});
