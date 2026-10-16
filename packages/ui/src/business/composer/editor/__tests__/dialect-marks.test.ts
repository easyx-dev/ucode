/** 编辑器里的方言呈现单测：围栏成芯片、写错的行出提示、代码区不参与 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InvocationCandidates } from "@ucode/markdown";

import { dialectMarksOf, dialectTextOf } from "../dialect-marks";
import { dialectSkeletonOf } from "../dialect-suggestion";

const candidates: InvocationCandidates = { prompts: [{ name: "todo" }], skills: [{ name: "pdf" }] };

const blocksOf = (...texts: string[]) =>
  texts.map((text, index) => ({ docFrom: index * 100 + 1, text }));

describe("dialectMarksOf", () => {
  it("成形的容器：开头行出芯片、收尾行淡出", () => {
    const marks = dialectMarksOf(blocksOf(":::command[todo]", "记一条", ":::"), candidates);

    assert.deepEqual(
      marks.map((mark) => [mark.kind, mark.from, mark.to]),
      [
        ["chip", 0, 16],
        ["close", 21, 24],
      ],
    );
  });

  it("名字不在清单：标成错误并带上诊断", () => {
    const marks = dialectMarksOf(blocksOf(":::command[nope]", "参数", ":::"), candidates);

    assert.equal(marks[0]?.kind, "error");
    assert.equal(marks[0]?.diagnostic?.code, "command-unknown");
  });

  it("没有收尾围栏：标成错误（内容取到文末）", () => {
    const marks = dialectMarksOf(blocksOf(":::skill[pdf]", "步骤"), candidates);

    assert.deepEqual(
      marks.map((mark) => mark.diagnostic?.code),
      ["container-unclosed"],
    );
  });

  it("同类文本当成嵌套：标成错误", () => {
    const marks = dialectMarksOf(
      blocksOf(":::command[todo]", "参数", ":::skill[pdf]", "技能", ":::", ":::"),
      candidates,
    );

    assert.equal(marks[0]?.diagnostic?.code, "container-nested");
  });

  it("代码围栏里的围栏行不参与", () => {
    const marks = dialectMarksOf(blocksOf("```", ":::command[todo]", ":::", "```"), candidates);

    assert.deepEqual(marks, []);
  });

  it("转义符只标记反斜杠本身（提示它是故意的）", () => {
    const marks = dialectMarksOf(blocksOf("看 \\@src/a.ts 与 \\![图](x)"), candidates);

    assert.deepEqual(
      marks.map((mark) => [mark.kind, mark.from]),
      [
        ["dim", 2],
        ["dim", 15],
      ],
    );
  });

  it("普通文本不产生任何标记", () => {
    assert.deepEqual(dialectMarksOf(blocksOf("看下 @src/a.ts", "结束"), candidates), []);
  });
});

describe("dialectTextOf", () => {
  it("块之间用换行拼接，与解析器看到的全文一致", () => {
    assert.equal(
      dialectTextOf(blocksOf(":::command[todo]", "记一条", ":::")),
      ":::command[todo]\n记一条\n:::",
    );
  });
});

describe("dialectSkeletonOf", () => {
  it("插入三段（围栏 / 空内容 / 收尾），光标落在内容行", () => {
    const skeleton = dialectSkeletonOf({
      id: "x",
      label: "x",
      group: "g",
      kind: "skill",
      name: "pdf",
    });

    assert.deepEqual(skeleton.nodes, [
      { type: "paragraph", content: [{ type: "text", text: ":::skill[pdf]" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: ":::" }] },
    ]);
    assert.equal(skeleton.caretOffset, ":::skill[pdf]".length + 2);
  });
});
