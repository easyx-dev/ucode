/** 引用锚点的识别：scheme 表决定什么算锚点，切分不能吞掉用户的话 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasMention, mentionLabelOf, mentionSchemeOf, splitMentions } from "../mention-anchor";

const ANCHOR = "@design:1d83d20a-f10c-4b0e-9c49-1a2b3c4d5e6f/340700262:4/340700262:38";
const SCHEMES = ["design", "design-term", "term"];

describe("引用锚点切分", () => {
  it("切出锚点与前后文本", () => {
    assert.deepEqual(splitMentions(`把 ${ANCHOR} 改成绿色`, SCHEMES), [
      { type: "text", text: "把 " },
      {
        type: "mention",
        scheme: "design",
        anchor: ANCHOR,
        payload: "1d83d20a-f10c-4b0e-9c49-1a2b3c4d5e6f/340700262:4/340700262:38",
      },
      { type: "text", text: " 改成绿色" },
    ]);
  });

  it("锚点后面紧跟中文不吃进 payload", () => {
    const parts = splitMentions(`${ANCHOR}改成绿色`, SCHEMES);
    assert.equal(parts.length, 2);
    assert.equal(parts[0]?.type, "mention");
    assert.equal(parts[1]?.type === "text" ? parts[1].text : "", "改成绿色");
  });

  it("scheme 不在表里就当普通文本", () => {
    const text = "@other:a/b/c";
    assert.equal(hasMention(text, SCHEMES), false);
    assert.deepEqual(splitMentions(text, SCHEMES), [{ type: "text", text }]);
  });

  it("长的 scheme 优先（design-term 不会被拆成 design）", () => {
    const parts = splitMentions("@design-term:a/b", SCHEMES);
    assert.equal(parts[0]?.type === "mention" ? parts[0].scheme : "", "design-term");
  });

  it("没有 scheme 表时整段原样留着", () => {
    assert.deepEqual(splitMentions(ANCHOR, []), [{ type: "text", text: ANCHOR }]);
    assert.equal(hasMention(ANCHOR, []), false);
  });

  it("一段里出现多次也都能切出来", () => {
    const parts = splitMentions(`${ANCHOR} 与 ${ANCHOR}`, SCHEMES);
    assert.equal(parts.filter((part) => part.type === "mention").length, 2);
  });

  it("chip 文案取 payload 里最具体的一段", () => {
    assert.equal(mentionLabelOf("340700262:38"), "38");
    assert.equal(mentionLabelOf("s/1:2/3:4"), "4");
    assert.equal(mentionLabelOf("s-1/7"), "7");
    assert.equal(mentionLabelOf(""), "");
  });

  it("像路径的锚点由 scheme 表认出来", () => {
    assert.equal(mentionSchemeOf("design:s/1/2", SCHEMES), "design");
    assert.equal(mentionSchemeOf("docs/a.md", SCHEMES), null);
  });
});
