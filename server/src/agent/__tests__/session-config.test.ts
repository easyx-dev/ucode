/** 会话装配层单测：工作目录解析的优先级 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionRecord } from "../../db/session-repository";
import { env } from "../../env";
import { resolveModeTools, resolveSessionCwd } from "../session-config";

const recordWith = (patch: Partial<SessionRecord>): SessionRecord => ({
  id: "s1",
  name: null,
  cwd: null,
  model: null,
  thinkingLevel: null,
  mode: "build",
  workspaceDir: null,
  piName: null,
  piCwd: null,
  sourcePath: null,
  persisted: false,
  entryCount: 0,
  messageCount: 0,
  preview: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

describe("resolveSessionCwd", () => {
  it("已落盘会话优先用 pi_cwd", () => {
    assert.equal(resolveSessionCwd(recordWith({ piCwd: "/pi", cwd: "/override" }), "/arg"), "/pi");
  });

  it("草稿行回落到覆盖值 cwd", () => {
    assert.equal(resolveSessionCwd(recordWith({ cwd: "/override" }), "/arg"), "/override");
  });

  it("没有会话记录时用调用方指定的目录", () => {
    assert.equal(resolveSessionCwd(undefined, "/arg"), "/arg");
  });

  it("都没有时回落到全局工作目录", () => {
    assert.equal(resolveSessionCwd(undefined), env.workspaceDir);
  });
});

/** 阶段 2 的模式工具集：build 全量（含扩展工具），ask / plan 按声明集过滤 */
describe("resolveModeTools", () => {
  const AVAILABLE = [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "webfetch",
    "websearch",
    "present_plan",
  ];
  const READ_ONLY = ["read", "grep", "find", "ls", "webfetch", "websearch"];

  it("build 用全部可用工具并并入扩展工具", () => {
    assert.deepEqual(resolveModeTools("build", AVAILABLE, ["ext_tool"]), [
      ...AVAILABLE,
      "ext_tool",
    ]);
  });

  it("plan / ask 只保留只读与联网工具", () => {
    assert.deepEqual(resolveModeTools("plan", AVAILABLE, ["ext_tool"]), [
      ...READ_ONLY,
      "present_plan",
    ]);
    assert.deepEqual(resolveModeTools("ask", AVAILABLE, ["ext_tool"]), READ_ONLY);
  });
});
