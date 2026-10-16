/** 会话分组单测：项目区按项目行的次序排（没有项目行的目录按创建时间），助理区平铺 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectSummary, SessionSummary } from "../../../types";
import { groupSessions, isWorkspaceSession } from "../session-groups";

const base: SessionSummary = {
  id: "",
  name: null,
  cwd: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  preview: "",
  model: null,
  thinkingLevel: "auto",
  resolvedThinkingLevel: "off",
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

/** 项目行在分组里只用 path（次序）与 name（组名），其余字段与分组无关 */
const project = (path: string): ProjectSummary => ({
  id: `id:${path}`,
  path,
  name: null,
  model: null,
  thinkingLevel: null,
  mode: null,
  permissionMode: null,
  memoryEnabled: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("groupSessions", () => {
  it("项目区按项目行的次序排，与组内会话的时间无关", () => {
    const sections = groupSessions(
      [
        // 入参已按 updatedAt 降序：项目 A 刚被用过，且它的会话创建得更早
        session({ id: "a1", cwd: "/work/a", createdAt: "2026-01-01T00:00:00.000Z" }),
        session({ id: "b1", cwd: "/work/b", createdAt: "2026-02-01T00:00:00.000Z" }),
      ],
      "/home/assistant",
      // 用户把 B 拖到了 A 前面
      [project("/work/b"), project("/work/a")],
    );

    assert.deepEqual(
      sections[0]?.groups.map((group) => group.name),
      ["b", "a"],
    );
  });

  it("没有项目行的目录排在已登记的后面，彼此按组内最早会话的创建时间降序", () => {
    const sections = groupSessions(
      [
        // 入参已按 updatedAt 降序：新建会话的是 D，最早建会话的是 C
        session({ id: "d1", cwd: "/work/d", createdAt: "2026-03-01T00:00:00.000Z" }),
        session({ id: "c1", cwd: "/work/c", createdAt: "2026-01-01T00:00:00.000Z" }),
        session({ id: "a1", cwd: "/work/a", createdAt: "2026-02-01T00:00:00.000Z" }),
      ],
      "/home/assistant",
      // C 与 D 还没登记过（早于项目表的会话），不占次序，都落在 A 之后
      [project("/work/a")],
    );

    assert.deepEqual(
      sections[0]?.groups.map((group) => group.name),
      ["a", "d", "c"],
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
    // 工作区根本身不算工作区（严格位于之下才算）
    assert.equal(isWorkspaceSession("/home/assistant", "/home/assistant"), false);
  });

  it("Windows 写法的路径同样成立（服务端可能跑在 Windows）", () => {
    assert.equal(
      isWorkspaceSession(
        "C:\\Users\\me\\appdata\\workspace\\s1",
        "C:\\Users\\me\\appdata\\workspace",
      ),
      true,
    );
    assert.equal(
      isWorkspaceSession("C:\\Users\\me\\appdata\\workspaces", "C:\\Users\\me\\appdata\\workspace"),
      false,
    );
    assert.equal(
      isWorkspaceSession(
        "C:\\Users\\me\\appdata\\workspace\\s1\\",
        "C:\\Users\\me\\appdata\\workspace\\",
      ),
      true,
    );
  });
});
