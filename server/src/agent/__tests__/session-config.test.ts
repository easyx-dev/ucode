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
  sourcePath: null,
  preview: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  ...patch,
});

describe("resolveSessionCwd", () => {
  it("绑定目录的会话用那个目录", () => {
    assert.equal(resolveSessionCwd(recordWith({ cwd: "/project" })), "/project");
  });

  it("未绑定目录的会话用工作区（由 id 派生）", () => {
    assert.equal(resolveSessionCwd(recordWith({})), `${env.workspaceRoot}/s1`);
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
