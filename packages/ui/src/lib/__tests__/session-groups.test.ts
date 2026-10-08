/** 会话分组单测：项目组按组内最早创建时间排序，助理区平铺 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupSessions, isWorkspaceSession } from "../session-groups";
import type { SessionSummary } from "../types";

const base: SessionSummary = {
  id: "",
  name: null,
  cwd: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  preview: "",
  model: null,
  thinkingLevel: "off",
  mode: "build",
  permissionMode: "default",
  parentSessionId: null,
  agent: null,
  forkedFromId: null,
  childCount: 0,
  running: false,
  status: "idle",
  pinnedAt: null,
  lastReadAt: null,
  deletedAt: null,
};

const session = (over: Partial<SessionSummary> & Pick<SessionSummary, "id" | "cwd">) => ({
  ...base,
  ...over,
});

describe("groupSessions", () => {
  it("项目组按组内最早会话的创建时间降序，新项目排最前", () => {
    const sections = groupSessions(
      [
        // 入参已按 updatedAt 降序：旧项目 A 刚被用过，新项目 B 更早创建
        session({ id: "a1", cwd: "/work/a", createdAt: "2026-01-01T00:00:00.000Z" }),
        session({ id: "b1", cwd: "/work/b", createdAt: "2026-02-01T00:00:00.000Z" }),
      ],
      "/home/assistant",
    );

    assert.deepEqual(
      sections[0]?.groups.map((group) => group.name),
      ["b", "a"],
    );
  });

  it("组内顺序保持入参顺序（updatedAt 降序），组间顺序不受新活动影响", () => {
    const sessions = [
      session({
        id: "b1",
        cwd: "/work/b",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
      session({
        id: "a2",
        cwd: "/work/a",
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
      }),
      session({
        id: "a1",
        cwd: "/work/a",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];

    const groups = groupSessions(sessions, null)[0]?.groups ?? [];

    // 排序键取组内最早的一条（a1），不是组内最近活动的那条
    assert.deepEqual(
      groups.map((group) => group.name),
      ["b", "a"],
    );
    assert.deepEqual(
      groups[1]?.sessions.map((item) => item.id),
      ["a2", "a1"],
    );
  });

  it("助理根下的会话进助理区且平铺", () => {
    const sections = groupSessions(
      [
        session({ id: "p1", cwd: "/work/a" }),
        session({ id: "s1", cwd: "/home/assistant/s1" }),
        session({ id: "s2", cwd: "/home/assistant/s2" }),
      ],
      "/home/assistant",
    );

    assert.deepEqual(
      sections.map((section) => section.kind),
      ["projects", "assistant"],
    );
    const assistant = sections[1];
    assert.equal(assistant?.groups.length, 1);
    assert.equal(assistant?.groups[0]?.path, null);
    assert.deepEqual(
      assistant?.groups[0]?.sessions.map((item) => item.id),
      ["s1", "s2"],
    );
  });

  it("空分区不输出", () => {
    assert.deepEqual(groupSessions([], null), []);
    assert.deepEqual(
      groupSessions([session({ id: "s1", cwd: "/home/assistant/s1" })], "/home/assistant").map(
        (section) => section.kind,
      ),
      ["assistant"],
    );
  });
});

describe("isWorkspaceSession", () => {
  it("只看目录前缀，前缀相同的兄弟目录不算在内", () => {
    assert.equal(isWorkspaceSession("/home/assistant/s1", "/home/assistant"), true);
    assert.equal(isWorkspaceSession("/home/assistant2/s1", "/home/assistant"), false);
  });
});
