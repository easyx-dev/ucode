/**
 * 手动压缩「正常拒绝」识别的单测：pi 只给文案，认不出来的必须按失败处理。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compactionSkipReasonOf } from "../compaction-skip";

describe("compactionSkipReasonOf", () => {
  it("识别「内容太少」与「已压缩过」两种正常拒绝", () => {
    assert.equal(
      compactionSkipReasonOf(new Error("Nothing to compact (session too small)")),
      "too_small",
    );
    assert.equal(compactionSkipReasonOf(new Error("Already compacted")), "already_compacted");
  });

  it("真实失败不被吞掉", () => {
    assert.equal(compactionSkipReasonOf(new Error("Compaction failed: upstream 500")), null);
    assert.equal(compactionSkipReasonOf(new Error("Compaction cancelled")), null);
    assert.equal(compactionSkipReasonOf("boom"), null);
    assert.equal(compactionSkipReasonOf(undefined), null);
  });
});
