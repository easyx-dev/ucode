import type { SessionSummary } from "@ucode/sdk";
import { describe, expect, it } from "vitest";
import {
  filterSessions,
  formatRelativeTime,
  groupSessionsByProject,
  projectLabel,
  sessionSubtitle,
  sessionTitle,
  sessionTone,
} from "../session-format.ts";

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    cwd: "/work/demo-app",
    name: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entryCount: 0,
    firstMessage: null,
    archived: false,
    ...over,
  };
}

const NOW = Date.parse("2026-01-10T12:00:00.000Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

describe("projectLabel", () => {
  it("取路径最后一段作为项目名", () => {
    expect(projectLabel("/Users/lyy/code/demo-app")).toBe("demo-app");
  });

  it("尾斜杠不影响（复制粘贴路径时很常见）", () => {
    expect(projectLabel("/Users/lyy/code/demo-app/")).toBe("demo-app");
  });

  it("空路径给可读兜底", () => {
    expect(projectLabel("   ")).toBe("未指定目录");
  });

  it("根目录保留原样而不是空串", () => {
    expect(projectLabel("/")).toBe("/");
  });
});

describe("formatRelativeTime", () => {
  it("按差值给中文相对时间", () => {
    expect(formatRelativeTime(ago(5_000), NOW)).toBe("刚刚");
    expect(formatRelativeTime(ago(12 * 60_000), NOW)).toBe("12分钟");
    expect(formatRelativeTime(ago(4 * 3600_000), NOW)).toBe("4小时");
    expect(formatRelativeTime(ago(3 * 24 * 3600_000), NOW)).toBe("3天");
    expect(formatRelativeTime(ago(14 * 24 * 3600_000), NOW)).toBe("2周");
  });

  it("超过五周换成日期（再算周数就没意义了）", () => {
    expect(formatRelativeTime(ago(60 * 24 * 3600_000), NOW)).toBe("2025-11-11");
  });

  it("非法时间返回空串，不显示 NaN", () => {
    expect(formatRelativeTime("不是时间", NOW)).toBe("");
  });
});

describe("sessionTitle", () => {
  it("名称优先于首条消息", () => {
    expect(sessionTitle(session({ name: "重构 UI", firstMessage: "帮我看看" }))).toBe("重构 UI");
  });

  it("没有名称时用首条消息，过长则截断", () => {
    expect(sessionTitle(session({ firstMessage: "帮我看看" }))).toBe("帮我看看");
    expect(sessionTitle(session({ firstMessage: "字".repeat(80) })).endsWith("…")).toBe(true);
  });

  it("都没有时退回 id 前缀（不能空着）", () => {
    expect(sessionTitle(session({ id: "abcdef123456" }))).toBe("abcdef1234");
  });
});

describe("sessionSubtitle", () => {
  it("有名称时副标题给首条消息", () => {
    expect(sessionSubtitle(session({ name: "甲", firstMessage: "乙" }))).toBe("乙");
  });

  it("没有名称时副标题给项目名（列表已经在按项目分组时也成立）", () => {
    expect(sessionSubtitle(session({ cwd: "/w/demo-app" }))).toBe("demo-app");
  });

  it("有名称但没消息时说明是空会话", () => {
    expect(sessionSubtitle(session({ name: "甲" }))).toBe("（空会话）");
  });
});

describe("groupSessionsByProject", () => {
  it("按工作目录分组，组间按最近会话倒序", () => {
    const groups = groupSessionsByProject([
      session({ id: "a", cwd: "/w/old", updatedAt: ago(90 * 24 * 3600_000) }),
      session({ id: "b", cwd: "/w/new", updatedAt: ago(3600_000) }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["new", "old"]);
  });

  it("组内按更新时间倒序", () => {
    const groups = groupSessionsByProject([
      session({ id: "a", cwd: "/w/x", updatedAt: ago(7200_000) }),
      session({ id: "b", cwd: "/w/x", updatedAt: ago(60_000) }),
    ]);
    expect(groups[0]?.sessions.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("没有会话时返回空数组", () => {
    expect(groupSessionsByProject([])).toEqual([]);
  });
});

describe("filterSessions", () => {
  it("默认隐藏已归档会话", () => {
    const sessions = [session({ id: "a" }), session({ id: "b", archived: true })];
    expect(filterSessions(sessions, "", false).map((item) => item.id)).toEqual(["a"]);
    expect(filterSessions(sessions, "", true).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("关键词同时匹配名称、首条消息与目录", () => {
    const sessions = [
      session({ id: "a", name: "重构 UI" }),
      session({ id: "b", firstMessage: "看看 store" }),
      session({ id: "c", cwd: "/w/marketplace" }),
    ];
    expect(filterSessions(sessions, "重", false).map((item) => item.id)).toEqual(["a"]);
    expect(filterSessions(sessions, "STORE", false).map((item) => item.id)).toEqual(["b"]);
    expect(filterSessions(sessions, "market", false).map((item) => item.id)).toEqual(["c"]);
  });

  it("关键词前后空格忽略", () => {
    expect(filterSessions([session({ id: "a", name: "甲" })], "  甲  ", false)).toHaveLength(1);
  });
});

describe("sessionTone", () => {
  it("只读挂载优先于运行中（写不了比在不在跑更重要）", () => {
    expect(sessionTone({ isActive: true, running: true, waiting: false, readOnly: true })).toBe(
      "readonly",
    );
  });

  it("等待应答优先于运行中", () => {
    expect(sessionTone({ isActive: true, running: true, waiting: true, readOnly: false })).toBe(
      "waiting",
    );
  });

  it("非活动会话的只读不当作状态（那是当前视角的事）", () => {
    expect(sessionTone({ isActive: false, running: false, waiting: false, readOnly: true })).toBe(
      "idle",
    );
  });
});
