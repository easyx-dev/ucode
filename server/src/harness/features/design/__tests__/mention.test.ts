/**
 * 引用锚点的单测：拼写、解析与归属校验。
 *
 * 归属校验是这套锚点的全部意义——锚点留在对话历史里，而历史比文档活得久。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDesignError } from "../errors";
import { assertAnchorOwnership, formatAnchor, mentionPrefixOf, parseAnchor } from "../mention";

describe("引用锚点", () => {
  it("按 会话 / 页 / 节点 三段拼写与解析", () => {
    const prefix = mentionPrefixOf("s-1");
    const anchor = formatAnchor(prefix, "1:2", "1:3");
    assert.equal(anchor, "@design:s-1/1:2/1:3");
    assert.deepEqual(parseAnchor(anchor), { sessionId: "s-1", pageId: "1:2", nodeId: "1:3" });
  });

  it("不是本方案的形状一律认不出", () => {
    for (const text of [
      "@src/a.ts",
      "design:s/1/2",
      "@design:s/1",
      "@design:s/1/2/3",
      "@design::1/2",
    ]) {
      assert.equal(parseAnchor(text), undefined, text);
    }
  });

  it("本会话的锚点放行，跨会话的直接拒", () => {
    const anchor = formatAnchor(mentionPrefixOf("s-1"), "1:2", "1:3");
    assert.deepEqual(assertAnchorOwnership(anchor, "s-1"), { pageId: "1:2", nodeId: "1:3" });

    try {
      assertAnchorOwnership(anchor, "s-2");
      assert.fail("跨会话的锚点不该通过");
    } catch (error: unknown) {
      assert.ok(isDesignError(error));
      assert.equal(error.code, "anchor_mismatch");
    }
  });

  it("认不出的引用按入参不成立报错，并给出下一步", () => {
    try {
      assertAnchorOwnership("@design:x", "s-1");
      assert.fail("残缺的锚点不该通过");
    } catch (error: unknown) {
      assert.ok(isDesignError(error));
      assert.equal(error.code, "invalid_input");
      assert.match(error.hint ?? "", /@design:/);
    }
  });
});
