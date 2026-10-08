/** 工具展示派生单测：工具名计数 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { subagentSessionIdOf, summarizeToolNames } from "../tool-view";

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

describe("subagentSessionIdOf", () => {
  it("从子智能体的结果里取出 task_id", () => {
    const result = [
      "task_id: 11111111-2222-3333-4444-555555555555（需要时可带 task_id 续跑）",
      "",
      "<task_result>",
      "数完了",
      "</task_result>",
    ].join("\n");
    assert.equal(
      subagentSessionIdOf({ id: "1", name: "subagent", result }),
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("没有结果或结果里没有 task_id 时为 null", () => {
    assert.equal(subagentSessionIdOf({ id: "1", name: "subagent" }), null);
    assert.equal(subagentSessionIdOf({ id: "1", name: "read", result: "文件内容" }), null);
  });

  it("只认行首的 task_id，正文里提到它不算", () => {
    assert.equal(
      subagentSessionIdOf({ id: "1", name: "read", result: "需要时带 task_id 续跑" }),
      null,
    );
  });
});
