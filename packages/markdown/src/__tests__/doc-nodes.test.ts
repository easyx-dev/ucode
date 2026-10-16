/** 编辑器文档模型的单测：附件序号、文本还原成列表、空文档判定与追加 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendNodesToDoc,
  attachmentOrdinalInDoc,
  type DocNode,
  isDocEmpty,
  pageElementNode,
  textToDoc,
} from "../doc-nodes.ts";
import { docToDialect } from "../document.ts";

const docOf = (children: DocNode[]): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: children }],
});

const text = (value: string): DocNode => ({ type: "text", text: value });
const mention = (path: string, attrs: Record<string, unknown> = {}): DocNode => ({
  type: "contextMention",
  attrs: { path, ...attrs },
});

/** 附件节点：`id` 为空表示还在上传中，身份落在 `tempId` 上 */
const attachment = (id: string, kind: "image" | "file", tempId: string | null = null): DocNode => ({
  type: "attachmentMention",
  attrs: { id, name: kind === "image" ? null : `${id}.pdf`, kind, tempId },
});

describe("引用与列表的方言投影", () => {
  it("引用保留位置，行范围只写进方言", () => {
    const dialect = docToDialect(
      docOf([text("把这个计划落到 "), mention("/repo/plans/x.md"), text(" 中")]),
      {},
    );

    assert.equal(dialect, "把这个计划落到 @/repo/plans/x.md 中");
  });

  it("多个引用按文档顺序，带行范围的写全", () => {
    const dialect = docToDialect(
      docOf([
        text("先看 "),
        mention("/repo/a.ts"),
        text(" 再看 "),
        mention("/repo/b.ts", { startLine: 3, endLine: 8 }),
      ]),
      {},
    );

    assert.equal(dialect, "先看 @/repo/a.ts 再看 @/repo/b.ts#L3-L8");
  });
});

describe("命令 / 技能的方言投影", () => {
  it("mention 变成容器，命令名与它之后的分隔空白都不进内容", () => {
    const dialect = docToDialect(
      docOf([
        { type: "commandMention", attrs: { kind: "skill", name: "review" } },
        text(" 看看这个"),
      ]),
      {},
    );

    assert.equal(dialect, ":::skill[review]\n看看这个\n:::");
  });

  // 没有那个分隔空白也要成立：名字与参数的边界是节点位置给的，不靠空白
  it("mention 后面没紧跟空白时，参数照样从第一个字开始", () => {
    const dialect = docToDialect(
      docOf([
        { type: "commandMention", attrs: { kind: "prompt", name: "todo" } },
        text("，有如果有未读的"),
      ]),
      {},
    );

    assert.equal(dialect, ":::command[todo]\n，有如果有未读的\n:::");
  });

  it("只有命令没有参数时内容为空，但仍算有内容", () => {
    const doc = docOf([{ type: "commandMention", attrs: { kind: "prompt", name: "review" } }]);

    assert.equal(docToDialect(doc, {}), ":::command[review]\n:::");
    assert.equal(isDocEmpty(doc), false);
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
    const doc: DocNode = {
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

const listItem = (...children: DocNode[]): DocNode => ({
  type: "listItem",
  content: children,
});

const bulletList = (...items: DocNode[]): DocNode => ({
  type: "bulletList",
  content: items,
});

const orderedList = (...items: DocNode[]): DocNode => ({
  type: "orderedList",
  content: items,
});

const paragraphOf = (...children: DocNode[]): DocNode => ({
  type: "paragraph",
  content: children,
});

const listDoc = (...blocks: DocNode[]): DocNode => ({ type: "doc", content: blocks });

describe("列表的方言投影", () => {
  it("无序列表还原成 `- ` 行", () => {
    const dialect = docToDialect(
      listDoc(
        bulletList(listItem(paragraphOf(text("第一条"))), listItem(paragraphOf(text("第二条")))),
      ),
      {},
    );
    assert.equal(dialect, "- 第一条\n- 第二条");
  });

  it("有序列表按位置编号", () => {
    const dialect = docToDialect(
      listDoc(orderedList(listItem(paragraphOf(text("甲"))), listItem(paragraphOf(text("乙"))))),
      {},
    );
    assert.equal(dialect, "1. 甲\n2. 乙");
  });

  it("嵌套列表缩进两空格", () => {
    const dialect = docToDialect(
      listDoc(
        orderedList(
          listItem(paragraphOf(text("父")), bulletList(listItem(paragraphOf(text("子"))))),
        ),
      ),
      {},
    );
    assert.equal(dialect, "1. 父\n  - 子");
  });

  it("列表项里的引用与附件照样收进载荷", () => {
    const dialect = docToDialect(
      listDoc(
        bulletList(
          listItem(paragraphOf(mention("/repo/a.ts"), text(" "), attachment("f1", "file"))),
        ),
      ),
      {},
    );
    assert.equal(dialect, "- @/repo/a.ts ![f1.pdf](attachment:pdf/f1)");
  });

  it("列表与段落混排时顺序不变", () => {
    const dialect = docToDialect(
      listDoc(
        paragraphOf(text("开头")),
        bulletList(listItem(paragraphOf(text("项")))),
        paragraphOf(text("结尾")),
      ),
      {},
    );
    assert.equal(dialect, "开头\n- 项\n结尾");
  });
});

describe("页面元素节点（编辑器里的芯片）", () => {
  it("进正文的是完整摘要，节点自己不产生任何字符", () => {
    const summary = "【页面元素】示例页（http://x/）\n- 选择器：#greet";
    const doc: DocNode = {
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
    assert.equal(docToDialect(doc, {}), `改一下这个\n${summary}`);
  });

  it("只有芯片的文档不算空（否则发送按钮会一直是禁用的）", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [pageElementNode({ label: "问候", summary: "摘要" })] },
      ],
    };
    assert.equal(isDocEmpty(doc), false);
  });

  it("追加节点时保留已有内容（外部插入走的就是这条路）", () => {
    const base: DocNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "先写的" }] }],
    };
    const doc = appendNodesToDoc(base, [
      { type: "paragraph", content: [pageElementNode({ label: "问候", summary: "摘要" })] },
    ]);
    assert.equal(docToDialect(doc, {}), "先写的\n摘要");
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
    assert.equal(docToDialect(doc, {}), summary);
  });
});

describe("textToDoc 还原列表", () => {
  it("`- ` 行收成一个无序列表，非列表行仍是段落", () => {
    const doc = textToDoc("说明\n- 一\n- 二");
    assert.equal(doc.content?.[0]?.type, "paragraph");
    assert.equal(doc.content?.[1]?.type, "bulletList");
    assert.equal(doc.content?.[1]?.content?.length, 2);
    assert.equal(docToDialect(doc, {}), "说明\n- 一\n- 二");
  });

  it("有序与嵌套缩进都能还原（发送出去仍是同一份文本）", () => {
    const source = "1. 父\n  - 子\n2. 兄弟";
    const doc = textToDoc(source);
    assert.equal(doc.content?.[0]?.type, "orderedList");
    assert.equal(doc.content?.[0]?.content?.[0]?.content?.[1]?.type, "bulletList");
    assert.equal(docToDialect(doc, {}), source);
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
