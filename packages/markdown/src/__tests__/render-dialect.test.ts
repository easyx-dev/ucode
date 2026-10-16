/** 方言渲染与转义单测：载荷 → 方言 → 载荷 往返幂等 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeDialect } from "../escape.ts";
import { parseDialect } from "../parse.ts";
import { renderDialect } from "../render.ts";
import type { DialectAttachmentView, InvocationCandidates } from "../types.ts";

const IMG = "b".repeat(64);
const PDF = "c".repeat(64);
const candidates: InvocationCandidates = { prompts: [{ name: "todo" }], skills: [{ name: "pdf" }] };
const views: DialectAttachmentView[] = [
  { id: IMG, kind: "image", name: null },
  { id: PDF, kind: "pdf", name: "报告.pdf" },
];

describe("renderDialect", () => {
  it("命令、技能与正文按固定顺序成文，附件与引用还原成方言记号", () => {
    const markdown = renderDialect(
      {
        command: { name: "todo", args: `根据 ![](attachment:image/${IMG}) 记一条` },
        skills: [{ name: "pdf", args: "生成报告" }],
        text: "看下 @src/auth.ts 与 附件 1.pdf",
        contexts: [{ path: "src/auth.ts", startLine: 10, endLine: 40 }],
        attachments: [{ id: IMG }, { id: PDF }],
        diagnostics: [],
      },
      views,
    );

    assert.equal(
      markdown,
      [
        `:::command[todo]\n根据 ![](attachment:image/${IMG}) 记一条\n:::`,
        `:::skill[pdf]\n生成报告\n:::`,
        `看下 @src/auth.ts#L10-L40 与 ![报告.pdf](attachment:pdf/${PDF})`,
      ].join("\n\n"),
    );
  });

  it("无参数的命令只写围栏", () => {
    const markdown = renderDialect(
      {
        skills: [],
        text: "",
        contexts: [],
        attachments: [],
        command: { name: "todo", args: "" },
        diagnostics: [],
      },
      [],
    );

    assert.equal(markdown, ":::command[todo]\n:::");
  });

  it("路径含空白时用方括号写法", () => {
    const markdown = renderDialect(
      {
        skills: [],
        text: "看 @[我的 笔记.md](我的 笔记.md)",
        contexts: [{ path: "我的 笔记.md" }],
        attachments: [],
        diagnostics: [],
      },
      [],
    );

    assert.equal(markdown, "看 @[我的 笔记.md](我的 笔记.md)");
  });
});

describe("往返", () => {
  // 参数里出现行首围栏时不转义就会提前闭合，往返一读内容就错位
  it("参数里的行首围栏先转义，往返仍然闭合", () => {
    const payload = {
      command: { name: "todo", args: "例子：\n:::\n上面是一个围栏" },
      skills: [],
      text: "",
      contexts: [],
      attachments: [],
      diagnostics: [],
    };

    const markdown = renderDialect(payload, []);

    assert.equal(markdown, ":::command[todo]\n例子：\n\\:::\n上面是一个围栏\n:::");
    assert.deepEqual(parseDialect(markdown, candidates), payload);
  });

  it("载荷 → 方言 → 载荷 幂等", () => {
    const payload = {
      command: { name: "todo", args: `看下 @src/auth.ts 与 图片 1` },
      skills: [{ name: "pdf", args: "生成报告" }],
      text: "收尾 @docs/a.md",
      contexts: [{ path: "src/auth.ts", startLine: 10, endLine: 40 }, { path: "docs/a.md" }],
      attachments: [{ id: IMG }],
      diagnostics: [],
    };

    const markdown = renderDialect(payload, views);
    assert.deepEqual(parseDialect(markdown, candidates), payload);
  });
});

describe("escapeDialect", () => {
  it("粘进来的命令围栏、引用与附件都变成字面", () => {
    const escaped = escapeDialect(":::command[todo]\n@src/a.ts ![](attachment:image/x)\n:::");

    assert.equal(escaped, "\\:::command[todo]\n\\@src/a.ts \\![](attachment:image/x)\n\\:::");
    const doc = parseDialect(escaped, candidates);
    assert.equal(doc.command, undefined);
    assert.deepEqual(doc.contexts, []);
    assert.deepEqual(doc.attachments, []);
  });
});
