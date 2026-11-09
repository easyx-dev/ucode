/**
 * 会话摘要单测：档位偏好的两档口径 —— `thinkingLevel` 存偏好（可为 `auto`），
 * `resolvedThinkingLevel` 是实际生效值。
 *
 * 关键约束：只有「会话不在内存 + 偏好 auto」才去问模式推荐值（那要扫角色目录），
 * 活会话一律取 pi 的实际值，避免显示与生效分家。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ThinkingLevel } from "@ucode/contracts";

import type { SessionRecord } from "../../db/session-repository";
import { describeSessionSummary, type SessionSummarySources } from "../session-summary";

const record = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  name: null,
  cwd: "/tmp/ws",
  model: null,
  thinkingLevel: null,
  mode: "build",
  permissionMode: null,
  parentSessionId: null,
  agent: null,
  forkedFromId: null,
  goalState: null,
  childCount: 0,
  sourcePath: "/tmp/sessions/s1.jsonl",
  preview: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  pinnedAt: null,
  lastReadAt: null,
  deletedAt: null,
  ...patch,
});

const sourcesOf = (
  stored: SessionRecord,
  options: { effective?: ThinkingLevel | null; recommended?: ThinkingLevel } = {},
): SessionSummarySources & { recommendedCalls: () => number } => {
  let calls = 0;
  return {
    repository: { find: (id: string) => (id === stored.id ? stored : undefined) },
    isActive: () => options.effective != null,
    statusOf: () => "done",
    defaultModel: () => "local/m",
    effectiveThinkingLevel: () => options.effective ?? null,
    recommendedThinkingLevel: () => {
      calls += 1;
      return options.recommended ?? "xhigh";
    },
    recommendedCalls: () => calls,
  } as unknown as SessionSummarySources & { recommendedCalls: () => number };
};

describe("会话摘要的思考档位", () => {
  it("偏好为 auto、会话不在内存时取模式推荐值", () => {
    const sources = sourcesOf(record());
    const summary = describeSessionSummary(sources, "s1");
    assert.equal(summary?.thinkingLevel, "auto");
    assert.equal(summary?.resolvedThinkingLevel, "xhigh");
    assert.equal(sources.recommendedCalls(), 1);
  });

  it("会话在内存时取 pi 的实际值，且不问模式推荐值", () => {
    // 模型不支持 xhigh 时 pi 会夹到相邻档位：显示必须跟着实际值走
    const sources = sourcesOf(record(), { effective: "high" });
    const summary = describeSessionSummary(sources, "s1");
    assert.equal(summary?.resolvedThinkingLevel, "high");
    assert.equal(sources.recommendedCalls(), 0);
  });

  it("选过具体档位就以它为准，不问模式推荐值", () => {
    const sources = sourcesOf(record({ thinkingLevel: "low" }));
    const summary = describeSessionSummary(sources, "s1");
    assert.equal(summary?.thinkingLevel, "low");
    assert.equal(summary?.resolvedThinkingLevel, "low");
    assert.equal(sources.recommendedCalls(), 0);
  });

  it("未落盘的草稿会话同样给出两档口径", () => {
    const summary = describeSessionSummary(
      sourcesOf(record({ sourcePath: null }), { recommended: "max" }),
      "s1",
    );
    assert.equal(summary?.thinkingLevel, "auto");
    assert.equal(summary?.resolvedThinkingLevel, "max");
  });

  it("行不存在返回 null", () => {
    assert.equal(describeSessionSummary(sourcesOf(record()), "nope"), null);
  });
});
