/** 设计锚点的识别：边界要对（相邻中文不能吃进 id），形状不对要原样留着 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { designAnchorLabel, hasDesignAnchor, splitDesignAnchors } from "../design-anchor";

const ANCHOR = "@design:1d83d20a-f10c-4b0e-9c49-1a2b3c4d5e6f/340700262:4/340700262:38";

describe("设计锚点切分", () => {
  it("切出锚点与前后文本", () => {
    const parts = splitDesignAnchors(`把 ${ANCHOR} 改成绿色`);
    assert.deepEqual(parts, [
      { type: "text", text: "把 " },
      {
        type: "designAnchor",
        anchor: ANCHOR,
        pageId: "340700262:4",
        nodeId: "340700262:38",
      },
      { type: "text", text: " 改成绿色" },
    ]);
  });

  it("锚点后面紧跟中文不吃进节点 id", () => {
    const parts = splitDesignAnchors(`${ANCHOR}改成绿色`);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0], {
      type: "designAnchor",
      anchor: ANCHOR,
      pageId: "340700262:4",
      nodeId: "340700262:38",
    });
  });

  it("形状不对的整段当文本：不吞用户的话", () => {
    for (const text of [
      "@design:abc/1/2",
      "@design:s/1:2/3",
      "@design:s/1:2/3:4:5",
      "@design:/1:2/3:4",
    ]) {
      assert.equal(hasDesignAnchor(text), false, text);
      assert.deepEqual(splitDesignAnchors(text), [{ type: "text", text }]);
    }
  });

  it("一段里出现多次也都能切出来", () => {
    const parts = splitDesignAnchors(`${ANCHOR} 与 ${ANCHOR}`);
    assert.equal(parts.filter((part) => part.type === "designAnchor").length, 2);
  });

  it("chip 文案取节点 id 的最后一段", () => {
    assert.equal(designAnchorLabel("340700262:38"), "38");
    assert.equal(designAnchorLabel("no-colon"), "no-colon");
  });
});
