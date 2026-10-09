/** 输入区文档 → 发送载荷的投影单测：引用在正文里留标记、命令 / 技能还原为文本 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachmentOrdinalInDoc, type ComposerNode, docToPayload } from "../composer-document";

const docOf = (children: ComposerNode[]): ComposerNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: children }],
});

const text = (value: string): ComposerNode => ({ type: "text", text: value });
const mention = (path: string, attrs: Record<string, unknown> = {}): ComposerNode => ({
  type: "contextMention",
  attrs: { path, ...attrs },
});

/** 附件节点：`id` 为空表示还在上传中，身份落在 `tempId` 上 */
const attachment = (
  id: string,
  kind: "image" | "file",
  tempId: string | null = null,
): ComposerNode => ({
  type: "attachmentMention",
  attrs: { id, name: kind === "image" ? null : `${id}.pdf`, kind, tempId },
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

describe("attachmentOrdinalInDoc 的序号", () => {
  it("两类各数各的：图片按图片数、文件按文件数", () => {
    const doc = docOf([
      attachment("i1", "image"),
      attachment("f1", "file"),
      attachment("i2", "image"),
      attachment("f2", "file"),
    ]);

    assert.equal(attachmentOrdinalInDoc(doc, "i1", "image"), 1);
    assert.equal(attachmentOrdinalInDoc(doc, "i2", "image"), 2);
    assert.equal(attachmentOrdinalInDoc(doc, "f1", "file"), 1);
    assert.equal(attachmentOrdinalInDoc(doc, "f2", "file"), 2);
  });

  it("跨段落接着数，不按段落重新开始", () => {
    const doc: ComposerNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [attachment("i1", "image")] },
        { type: "paragraph", content: [text("中间一段"), attachment("i2", "image")] },
      ],
    };

    assert.equal(attachmentOrdinalInDoc(doc, "i2", "image"), 2);
  });

  it("上传中的占位按 tempId 认出来，照样占号", () => {
    const doc = docOf([attachment("", "image", "t1"), attachment("i1", "image")]);

    assert.equal(attachmentOrdinalInDoc(doc, "t1", "image"), 1);
    assert.equal(attachmentOrdinalInDoc(doc, "i1", "image"), 2);
  });

  it("key 不在文档里、或同类里没有它时返回 0", () => {
    const doc = docOf([attachment("i1", "image")]);

    assert.equal(attachmentOrdinalInDoc(doc, "nope", "image"), 0);
    assert.equal(attachmentOrdinalInDoc(doc, "i1", "file"), 0);
    assert.equal(attachmentOrdinalInDoc(null, "i1", "image"), 0);
  });
});
