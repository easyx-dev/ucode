/** 工具展示派生单测：工具名计数、分类与入参摘要 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { subagentSessionIdOf, summarizeToolNames, toolInputOf, toolKindOf } from "../tool-view";

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
  it("从子智能体的结果里取出 task_id（id 带 sub- 前缀、后面紧跟全角括号）", () => {
    const result = [
      "task_id: sub-11111111-2222-3333-4444-555555555555（需要时可带 task_id 续跑）",
      "",
      "<task_result>",
      "数完了",
      "</task_result>",
    ].join("\n");
    assert.equal(
      subagentSessionIdOf({ id: "1", name: "subagent", result }),
      "sub-11111111-2222-3333-4444-555555555555",
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

describe("toolKindOf", () => {
  it("浏览器工具归到自己的分类（不再落成「其他」）", () => {
    for (const name of [
      "browser_open",
      "browser_snapshot",
      "browser_act",
      "browser_screenshot",
      "browser_close",
    ]) {
      assert.equal(toolKindOf(name), "browser", name);
    }
    assert.equal(toolKindOf("mcp__x__y"), "other");
  });
});

describe("toolInputOf", () => {
  it("浏览器工具给出调用形态，而不是让界面兜底成参数 JSON", () => {
    assert.deepEqual(toolInputOf("browser_open", { url: "http://127.0.0.1:5173" }), {
      type: "url",
      url: "http://127.0.0.1:5173",
    });
    assert.deepEqual(toolInputOf("browser_act", { action: "click", ref: "@e1a2" }), {
      type: "action",
      action: "click",
      target: "@e1a2",
    });
    // 没有 ref 的动作带的是按键 / 滚动方向
    assert.deepEqual(toolInputOf("browser_act", { action: "press", key: "Enter" }), {
      type: "action",
      action: "press",
      target: "Enter",
    });
    assert.deepEqual(toolInputOf("browser_act", { action: "scroll" }), {
      type: "action",
      action: "scroll",
    });
    assert.deepEqual(toolInputOf("browser_screenshot", { fullPage: true }), {
      type: "screenshot",
      fullPage: true,
    });
    assert.deepEqual(toolInputOf("browser_screenshot", { ref: "@e1a2" }), {
      type: "screenshot",
      fullPage: false,
      ref: "@e1a2",
    });
    assert.deepEqual(toolInputOf("browser_snapshot", { profile: "work" }), { type: "none" });
    assert.deepEqual(toolInputOf("browser_close", {}), { type: "none" });
  });
});
