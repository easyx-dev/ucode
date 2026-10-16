/** 命令菜单的触发符：`/` 与 `、` 都唤起，别的字符不唤起；只认文档开头那一次 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { EditorState, TextSelection } from "@tiptap/pm/state";

import { COMMAND_TRIGGERS, findCommandMatch } from "../command-trigger";

const schema = getSchema([Document, Paragraph, Text]);

/** 光标停在一段文本末尾时问一次匹配；配置与命令菜单一致（空白前缀、不限行首，行首限定由 `allow` 把） */
const matchAt = (text: string) => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, doc.content.size - 1),
  });
  return findCommandMatch({
    char: COMMAND_TRIGGERS[0],
    allowSpaces: false,
    allowToIncludeChar: false,
    allowedPrefixes: [" "],
    startOfLine: false,
    $position: state.selection.$from,
  });
};

describe("findCommandMatch", () => {
  it("`/` 与 `、` 都唤起，范围含触发符本身、查询串去掉它", () => {
    for (const trigger of COMMAND_TRIGGERS) {
      assert.deepEqual(
        matchAt(`${trigger}re`),
        { range: { from: 1, to: 4 }, query: "re", text: `${trigger}re` },
        trigger,
      );
    }
  });

  it("触发符在文档中间（前面还有字）时不唤起", () => {
    assert.equal(matchAt("先、re"), null);
    assert.equal(matchAt("先/re"), null);
  });

  it("别的字符不唤起", () => {
    assert.equal(matchAt("@re"), null);
    assert.equal(matchAt("re"), null);
    assert.equal(matchAt("。re"), null);
  });

  it("文本里前面还有一个触发符时，后面那个照常唤起", () => {
    // 空格分隔的两个触发符：前一个的候选范围已经不含光标，算不到它头上
    assert.deepEqual(matchAt("、 /re"), {
      range: { from: 3, to: 6 },
      query: "re",
      text: "/re",
    });
  });

  it("没有候选态文本时返回 null", () => {
    assert.equal(matchAt(""), null);
  });
});
