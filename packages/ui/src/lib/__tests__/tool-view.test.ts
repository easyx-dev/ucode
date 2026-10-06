/** 工具展示派生单测：工具名计数 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeToolNames } from "../tool-view";

describe("summarizeToolNames", () => {
  it("按工具名计数，并按首次出现顺序排列", () => {
    assert.deepEqual(
      summarizeToolNames([
        { id: "1", name: "edit" },
        { id: "2", name: "bash" },
        { id: "3", name: "edit" },
      ]),
      [
        { name: "edit", count: 2 },
        { name: "bash", count: 1 },
      ],
    );
  });
});
