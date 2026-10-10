/** shiki-diff：diff 视图的高亮适配器（语言就绪判定、着色值来自设计 token、超阈值退回纯文本） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDiffHighlighter } from "../shiki-diff";
import { HIGHLIGHT_MAX_LINES } from "../shiki-languages";

/** `getAST` 在库里的类型是重载函数，测试里按实际调用形状收窄 */
type AstOf = (raw: string, fileName?: string, lang?: string) => unknown;

describe("createDiffHighlighter", () => {
  it("语言不认识时返回 null（调用方据此不开高亮）", async () => {
    assert.equal(await createDiffHighlighter("notes.unknown"), null);
  });

  it("语言就绪后给出适配器，着色值取自 --code-* 变量", async () => {
    const highlighter = await createDiffHighlighter("typescript");
    assert.ok(highlighter);
    assert.equal(highlighter.hasRegisteredCurrentLang("typescript"), true);
    assert.equal(highlighter.type, "style", "着色走内联 style，不依赖 .hljs-* 类");

    const ast = (highlighter.getAST as AstOf)("const answer = 1;\n", "a.ts", "typescript");
    assert.ok(ast, "语言已就绪时必须给出 AST");
    assert.match(JSON.stringify(ast), /var\(--code-/, "着色值必须是设计 token 变量");
  });

  it("大段代码退回纯文本（与文件预览同一套阈值）", async () => {
    const highlighter = await createDiffHighlighter("typescript");
    assert.ok(highlighter);

    const huge = "const answer = 1;\n".repeat(HIGHLIGHT_MAX_LINES + 1);
    assert.equal((highlighter.getAST as AstOf)(huge, "a.ts", "typescript"), undefined);
  });

  it("阈值与忽略列表可被库改写", async () => {
    const highlighter = await createDiffHighlighter("typescript");
    assert.ok(highlighter);

    highlighter.setMaxLineToIgnoreSyntax(10);
    assert.deepEqual(highlighter.maxLineToIgnoreSyntax, 10);
    highlighter.setIgnoreSyntaxHighlightList(["*.min.js"]);
    assert.deepEqual(highlighter.ignoreSyntaxHighlightList, ["*.min.js"]);
  });
});
