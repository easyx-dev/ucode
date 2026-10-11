/** harness 公共取文本单测：只认 `TextContent`，别的块即使带 `text` 字段也不取 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { textOfContent } from "../text";

describe("textOfContent", () => {
  it("字符串原样返回", () => {
    assert.equal(textOfContent("正文"), "正文");
  });

  it("内容块只取 type=text 的 text 字段，分隔符可换", () => {
    const blocks = [
      { type: "text", text: "第一段" },
      { type: "thinking", thinking: "内部推理" },
      { type: "toolCall", name: "bash", text: "带 text 字段但不是文本块" },
      { type: "text", text: "第二段" },
    ];

    assert.equal(textOfContent(blocks), "第一段 第二段");
    assert.equal(textOfContent(blocks, "\n"), "第一段\n第二段");
  });

  it("空片段被跳过，非内容值给空串", () => {
    const blocks = [
      { type: "text", text: "" },
      { type: "text", text: "正文" },
    ];

    assert.equal(textOfContent(blocks), "正文");
    assert.equal(textOfContent(undefined), "");
    assert.equal(textOfContent(42), "");
    assert.equal(textOfContent([{ type: "text" }]), "");
  });
});
