/** 会话工作目录口径单测：绑定目录用记录里的目录，未绑定用按 id 派生的工作区 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionRecord } from "../../db/session-repository";
import { env } from "../../env";
import { resolveSessionCwd } from "../session-paths";

const recordWith = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  name: null,
  cwd: null,
  model: null,
  thinkingLevel: null,
  mode: "build",
  permissionMode: null,
  parentSessionId: null,
  agent: null,
  forkedFromId: null,
  goalState: null,
  childCount: 0,
  sourcePath: null,
  preview: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  pinnedAt: null,
  lastReadAt: null,
  deletedAt: null,
  ...patch,
});

describe("resolveSessionCwd", () => {
  it("绑定目录的会话用那个目录", () => {
    assert.equal(resolveSessionCwd(recordWith({ cwd: "/project" })), "/project");
  });

  it("未绑定目录的会话用工作区（由 id 派生）", () => {
    assert.equal(resolveSessionCwd(recordWith()), `${env.workspacesDir}/s1`);
  });
});
