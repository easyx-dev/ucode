/** 输入区文档 → 发送载荷的投影单测：引用在正文里留标记、命令 / 技能还原为文本 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type ComposerNode, docToPayload } from "../composer-document";

const docOf = (children: ComposerNode[]): ComposerNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: children }],
});

const text = (value: string): ComposerNode => ({ type: "text", text: value });
const mention = (path: string, attrs: Record<string, unknown> = {}): ComposerNode => ({
  type: "contextMention",
  attrs: { path, ...attrs },
});

describe("docToPayload 的 `@` 引用", () => {
  it("引用在正文里落成标记，位置不变", () => {
    const payload = docToPayload(
      docOf([text("把这个计划落到 "), mention("/repo/plans/x.md"), text(" 中")]),
    );

    assert.equal(payload.text, "把这个计划落到 @/repo/plans/x.md 中");
    assert.deepEqual(payload.contexts, [{ path: "/repo/plans/x.md" }]);
  });

  it("多个引用按文档顺序进正文与 contexts", () => {
    const payload = docToPayload(
      docOf([
        text("先看 "),
        mention("/repo/a.ts"),
        text(" 再看 "),
        mention("/repo/b.ts", { startLine: 3, endLine: 8 }),
      ]),
    );

    assert.equal(payload.text, "先看 @/repo/a.ts 再看 @/repo/b.ts");
    assert.deepEqual(payload.contexts, [
      { path: "/repo/a.ts" },
      { path: "/repo/b.ts", startLine: 3, endLine: 8 },
    ]);
  });

  it("只有引用、没有正文时也能发出", () => {
    const payload = docToPayload(docOf([mention("/repo/a.ts")]));
    assert.equal(payload.text, "@/repo/a.ts");
    assert.equal(payload.contexts.length, 1);
  });
});

describe("docToPayload 的命令与技能", () => {
  it("命令 / 技能 mention 还原为 `/name` 与 `/skill:name`", () => {
    const payload = docToPayload(
      docOf([
        { type: "commandMention", attrs: { kind: "skill", name: "review" } },
        text(" 看看这个"),
      ]),
    );

    assert.equal(payload.text, "/skill:review 看看这个");
    assert.deepEqual(payload.contexts, []);
  });
});
