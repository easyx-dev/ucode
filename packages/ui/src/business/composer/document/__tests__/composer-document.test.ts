/** 输入区文档 → 发送载荷的投影单测：引用在正文里留标记、命令 / 技能还原为文本 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendNodesToDoc,
  attachmentOrdinalInDoc,
  type ComposerNode,
  docToPayload,
  isDocEmpty,
  pageElementNode,
  textToDoc,
} from "../composer-document";

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

const listItem = (...children: ComposerNode[]): ComposerNode => ({
  type: "listItem",
  content: children,
});

const bulletList = (...items: ComposerNode[]): ComposerNode => ({
  type: "bulletList",
  content: items,
});

const orderedList = (...items: ComposerNode[]): ComposerNode => ({
  type: "orderedList",
  content: items,
});

const paragraphOf = (...children: ComposerNode[]): ComposerNode => ({
  type: "paragraph",
  content: children,
});

const listDoc = (...blocks: ComposerNode[]): ComposerNode => ({ type: "doc", content: blocks });

describe("docToPayload 的列表", () => {
  it("无序列表还原成 `- ` 行", () => {
    const payload = docToPayload(
      listDoc(
        bulletList(listItem(paragraphOf(text("第一条"))), listItem(paragraphOf(text("第二条")))),
      ),
    );
    assert.equal(payload.text, "- 第一条\n- 第二条");
  });

  it("有序列表按位置编号", () => {
    const payload = docToPayload(
      listDoc(orderedList(listItem(paragraphOf(text("甲"))), listItem(paragraphOf(text("乙"))))),
    );
    assert.equal(payload.text, "1. 甲\n2. 乙");
  });

  it("嵌套列表缩进两空格", () => {
    const payload = docToPayload(
      listDoc(
        orderedList(
          listItem(paragraphOf(text("父")), bulletList(listItem(paragraphOf(text("子"))))),
        ),
      ),
    );
    assert.equal(payload.text, "1. 父\n  - 子");
  });

  it("列表项里的引用与附件照样收进载荷", () => {
    const payload = docToPayload(
      listDoc(
        bulletList(
          listItem(paragraphOf(mention("/repo/a.ts"), text(" "), attachment("f1", "file"))),
        ),
      ),
    );
    assert.equal(payload.text, "- @/repo/a.ts 附件 1.pdf");
    assert.deepEqual(payload.contexts, [{ path: "/repo/a.ts" }]);
    assert.deepEqual(payload.attachments, [{ id: "f1" }]);
  });

  it("列表与段落混排时顺序不变", () => {
    const payload = docToPayload(
      listDoc(
        paragraphOf(text("开头")),
        bulletList(listItem(paragraphOf(text("项")))),
        paragraphOf(text("结尾")),
      ),
    );
    assert.equal(payload.text, "开头\n- 项\n结尾");
  });
});

describe("页面元素节点（编辑器里的芯片）", () => {
  it("进正文的是完整摘要，节点自己不产生任何字符", () => {
    const summary = "【页面元素】示例页（http://x/）\n- 选择器：#greet";
    const doc: ComposerNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "改一下这个" }] },
        {
          type: "paragraph",
          content: [
            pageElementNode({
              label: "问候",
              summary,
              url: "http://x/",
              title: "示例页",
              selector: "#greet",
            }),
          ],
        },
      ],
    };

    // 段落之间隔一个换行：摘要落在用户那句话的下一行
    assert.equal(docToPayload(doc).text, `改一下这个\n${summary}`);
  });

  it("只有芯片的文档不算空（否则发送按钮会一直是禁用的）", () => {
    const doc: ComposerNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [pageElementNode({ label: "问候", summary: "摘要" })] },
      ],
    };
    assert.equal(isDocEmpty(doc), false);
  });

  it("追加节点时保留已有内容（外部插入走的就是这条路）", () => {
    const base: ComposerNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "先写的" }] }],
    };
    const doc = appendNodesToDoc(base, [
      { type: "paragraph", content: [pageElementNode({ label: "问候", summary: "摘要" })] },
    ]);
    assert.equal(docToPayload(doc).text, "先写的\n摘要");
  });
});

describe("外部插入的一段上下文（页面元素摘要）", () => {
  it("往返后原文不变（字段行会渲染成列表，但发出去的还是原样）", () => {
    const summary = [
      "【页面元素】订单列表（http://localhost:5173/orders）",
      '- 元素：button "导出"（<button>）',
      '- 选择器：[data-testid="export"]',
      "- 位置：x=1024, y=64, 72 × 32",
      "- 样式：颜色 foreground-value；背景 background-value；字体 14px Inter",
      '- 属性：id="export" class="btn primary"',
      "- 文本：导出",
      "- 附近：已选 12 条 · 共 38 条",
      "",
      "```html",
      '<button id="export">导出</button>',
      "```",
    ].join("\n");

    const doc = textToDoc(summary);
    // 字段行被解析成无序列表（渲染好看），这是有意的
    assert.equal(doc.content?.[1]?.type, "bulletList");
    assert.equal(docToPayload(doc).text, summary);
  });
});

describe("textToDoc 还原列表", () => {
  it("`- ` 行收成一个无序列表，非列表行仍是段落", () => {
    const doc = textToDoc("说明\n- 一\n- 二");
    assert.equal(doc.content?.[0]?.type, "paragraph");
    assert.equal(doc.content?.[1]?.type, "bulletList");
    assert.equal(doc.content?.[1]?.content?.length, 2);
    assert.equal(docToPayload(doc).text, "说明\n- 一\n- 二");
  });

  it("有序与嵌套缩进都能还原（发送出去仍是同一份文本）", () => {
    const source = "1. 父\n  - 子\n2. 兄弟";
    const doc = textToDoc(source);
    assert.equal(doc.content?.[0]?.type, "orderedList");
    assert.equal(doc.content?.[0]?.content?.[0]?.content?.[1]?.type, "bulletList");
    assert.equal(docToPayload(doc).text, source);
  });

  it("同一层换列表种类时另起一个列表", () => {
    const doc = textToDoc("- 一\n1. 二");
    assert.equal(doc.content?.length, 2);
    assert.equal(doc.content?.[1]?.type, "orderedList");
  });
});

describe("attachmentOrdinalInDoc 的列表", () => {
  it("列表项里的附件按文档顺序占号", () => {
    const doc = listDoc(
      paragraphOf(attachment("i1", "image")),
      bulletList(
        listItem(paragraphOf(text("项"), attachment("i2", "image"))),
        listItem(paragraphOf(text("项二"), attachment("i3", "image"))),
      ),
    );
    assert.equal(attachmentOrdinalInDoc(doc, "i2", "image"), 2);
    assert.equal(attachmentOrdinalInDoc(doc, "i3", "image"), 3);
  });
});
