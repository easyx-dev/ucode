/** 文档视图 → 方言：容器、行内记号、手打命令的定形糖 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type DocNode, docToDialect } from "../document.ts";
import { parseDialect } from "../parse.ts";
import type { InvocationCandidates } from "../types.ts";

const IMG = "b".repeat(64);
const candidates: InvocationCandidates = { prompts: [{ name: "todo" }], skills: [{ name: "pdf" }] };

const docOf = (...children: DocNode[]): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: children }],
});
const text = (value: string): DocNode => ({ type: "text", text: value });
const mention = (path: string, attrs: Record<string, unknown> = {}): DocNode => ({
  type: "contextMention",
  attrs: { path, ...attrs },
});
const attachment = (
  id: string,
  kind: "image" | "file",
  name: string | null = null,
  schemeKind?: string,
): DocNode => ({
  type: "attachmentMention",
  attrs: { id, name, kind, tempId: null, ...(schemeKind ? { schemeKind } : {}) },
});

describe("docToDialect", () => {
  it("命令 mention 变成容器，参数是节点之后的文本", () => {
    const dialect = docToDialect(
      docOf({ type: "commandMention", attrs: { kind: "prompt", name: "todo" } }, text(" 记一条")),
      { candidates },
    );

    assert.equal(dialect, ":::command[todo]\n记一条\n:::");
  });

  it("附件与引用按方言写法落进正文", () => {
    const dialect = docToDialect(
      docOf(
        text("看 "),
        attachment(IMG, "image", null, "image"),
        text(" 与 "),
        mention("src/auth.ts", { startLine: 10, endLine: 40 }),
      ),
      { candidates },
    );

    assert.equal(dialect, `看 ![](attachment:image/${IMG}) 与 @src/auth.ts#L10-L40`);
  });

  // name 与 schemeKind 在文档里可能缺（编辑回填的老节点）：按扩展名兜底，别退化成 binary
  it("附件类型缺失时按文件名推断", () => {
    const dialect = docToDialect(docOf(attachment(IMG, "file", "季度报告.pdf")), { candidates });

    assert.equal(dialect, `![季度报告.pdf](attachment:pdf/${IMG})`);
  });

  it("手打的 `/名字 参数` 命中清单时整段变成容器", () => {
    const dialect = docToDialect(docOf(text("/todo 记一条")), { candidates });

    assert.equal(dialect, ":::command[todo]\n记一条\n:::");
  });

  it("手打但没命中清单、或是留给客户端的名字时保持原样", () => {
    assert.equal(docToDialect(docOf(text("/nope 记一条")), { candidates }), "/nope 记一条");
    assert.equal(
      docToDialect(docOf(text("/goal 把缓存做对")), { candidates, reserved: ["goal"] }),
      "/goal 把缓存做对",
    );
  });

  it("列表按 Markdown 还原，与文档投影同口径", () => {
    const dialect = docToDialect(
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [text("第一条")] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [text("第二条")] }] },
            ],
          },
        ],
      },
      { candidates },
    );

    assert.equal(dialect, "- 第一条\n- 第二条");
  });

  it("投影出去再解析，命令、引用与附件都对得上", () => {
    const dialect = docToDialect(
      docOf(
        { type: "commandMention", attrs: { kind: "prompt", name: "todo" } },
        text(" 根据 "),
        attachment(IMG, "image", null, "image"),
        text(" 与 "),
        mention("src/auth.ts", { startLine: 10 }),
        text(" 记一条"),
      ),
      { candidates },
    );

    assert.deepEqual(parseDialect(dialect, candidates), {
      command: { name: "todo", args: `根据 图片 1 与 @src/auth.ts 记一条` },
      skills: [],
      text: "",
      contexts: [{ path: "src/auth.ts", startLine: 10 }],
      attachments: [{ id: IMG }],
      diagnostics: [],
    });
  });
});

describe("手打的容器与命令 chip 并存", () => {
  it("容器当兄弟块，不被塞进命令参数", () => {
    const dialect = docToDialect(
      docOf(
        { type: "commandMention", attrs: { kind: "prompt", name: "todo" } },
        text(" "),
        text("看下这个"),
        text("\n:::skill[pdf]\n生成报告\n:::"),
      ),
      { candidates },
    );

    assert.equal(dialect, ":::command[todo]\n看下这个\n:::\n\n:::skill[pdf]\n生成报告\n:::");
    // 解析回来：命令与技能各归各位，且没有「容器里套容器」这类诊断
    assert.deepEqual(parseDialect(dialect, candidates), {
      command: { name: "todo", args: "看下这个" },
      skills: [{ name: "pdf", args: "生成报告" }],
      text: "",
      contexts: [],
      attachments: [],
      diagnostics: [],
    });
  });

  it("只有手打容器、没有命令 chip 时顺序不变", () => {
    const dialect = docToDialect(
      docOf(text("开头"), text("\n:::skill[pdf]\n一\n:::"), text("\n结尾")),
      { candidates },
    );

    // 正文各段合起来排在容器之前（与投递顺序一致），段间空行保留
    assert.equal(dialect, "开头\n\n结尾\n\n:::skill[pdf]\n一\n:::");
  });

  it("代码围栏里的容器行不当容器（判据与解析器一致）", () => {
    const dialect = docToDialect(
      docOf(
        { type: "commandMention", attrs: { kind: "prompt", name: "todo" } },
        text(" "),
        text("```\n:::skill[pdf]\n```"),
      ),
      { candidates },
    );

    // 代码区里的围栏行留在参数里当字面文字（只转义 `:::`，代码围栏本身不动）
    assert.equal(dialect, ":::command[todo]\n```\n\\:::skill[pdf]\n```\n:::");
  });
});
