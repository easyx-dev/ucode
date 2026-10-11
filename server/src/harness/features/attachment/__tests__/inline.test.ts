/** harness/features/attachment/inline：正文里的附件标记按位置展开，对不上就整段退回 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inlineAttachmentText } from "../inline";

const ID_A = "a".repeat(64);
const ID_B = "b".repeat(64);
const ID_IMG = "c".repeat(64);

const refOf = (name: string, id: string): string => `[附件: ${name} (id: ${id})]`;

describe("inlineAttachmentText", () => {
  it("非图片标记就地换成引用行，图片标记留着", () => {
    const text = "看下 图片 1 与 附件 1.pdf 的差别";

    const out = inlineAttachmentText(text, {
      imageCount: 1,
      files: [{ id: ID_A, name: "报告.pdf" }],
    });

    assert.equal(out, `看下 图片 1 与 ${refOf("报告.pdf", ID_A)} 的差别`);
  });

  it("多个附件按各自序号落回原位", () => {
    const text = "附件 1.pdf 对比 附件 2.md，图见 图片 1";

    const out = inlineAttachmentText(text, {
      imageCount: 1,
      files: [
        { id: ID_A, name: "a.pdf" },
        { id: ID_B, name: "b.md" },
      ],
    });

    assert.equal(out, `${refOf("a.pdf", ID_A)} 对比 ${refOf("b.md", ID_B)}，图见 图片 1`);
  });

  it("扩展名认不出时只写 `附件 N` 也能对上", () => {
    const out = inlineAttachmentText("见 附件 1", {
      imageCount: 0,
      files: [{ id: ID_A, name: null }],
    });
    assert.equal(out, `见 ${refOf(ID_A, ID_A)}`);
  });

  it("没有附件与标记时原样返回", () => {
    assert.equal(
      inlineAttachmentText("随便说点什么", { imageCount: 0, files: [] }),
      "随便说点什么",
    );
  });

  it("用户手打的同名标记但扩展名不符时对不上", () => {
    const out = inlineAttachmentText("见附件 1.txt 的说明", {
      imageCount: 0,
      files: [{ id: ID_A, name: "report.pdf" }],
    });
    assert.equal(out, null);
  });

  it("附件都没出现在正文里时对不上", () => {
    assert.equal(
      inlineAttachmentText("看下这张图", { imageCount: 0, files: [{ id: ID_A, name: "a.pdf" }] }),
      null,
    );
  });

  it("序号跳跃或倒序时对不上", () => {
    assert.equal(
      inlineAttachmentText("附件 2.pdf 与 附件 1.pdf", {
        imageCount: 0,
        files: [
          { id: ID_A, name: "a.pdf" },
          { id: ID_B, name: "b.pdf" },
        ],
      }),
      null,
    );
  });

  it("正文里有图片标记但这条消息没带图片时对不上", () => {
    assert.equal(inlineAttachmentText("看 图片 1 与 图片 2", { imageCount: 1, files: [] }), null);
  });

  it("图片数按 vision 数组的对齐要求校验，不匹配就退回", () => {
    assert.equal(inlineAttachmentText("看 图片 1", { imageCount: 0, files: [] }), null);
    assert.equal(inlineAttachmentText("看 图片 1", { imageCount: 1, files: [] }), "看 图片 1");
  });

  it("文件名里的方括号与换行会破坏引用行解析，统一换成下划线", () => {
    const out = inlineAttachmentText("见 附件 1.pdf", {
      imageCount: 0,
      files: [{ id: ID_IMG, name: "报[告].pdf" }],
    });
    assert.equal(out, `见 [附件: 报_告_.pdf (id: ${ID_IMG})]`);
  });
});
