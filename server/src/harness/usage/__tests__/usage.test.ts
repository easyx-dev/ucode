/**
 * 使用统计单测：用量点解析与聚合，以及从会话文件读取 + 来源分类。
 *
 * 纯函数部分用合成条目直接断言；服务部分用真实 `SessionManager` 在临时目录造会话文件，
 * 不依赖模型与网络。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import type { SessionRecord, SessionRepository } from "../../../db/session-repository";
import { localDateKeyOf } from "../aggregate";
import { collectUsage, UsageService } from "../index";

type UsageShape = { input: number; output: number; cacheRead: number; cacheWrite: number };

const assistantEntry = (over: {
  id: string;
  timeMs: number;
  provider?: string;
  model?: string;
  usage?: unknown;
  content?: unknown;
}): unknown => ({
  type: "message",
  id: over.id,
  parentId: null,
  timestamp: new Date(over.timeMs).toISOString(),
  message: {
    role: "assistant",
    provider: over.provider ?? "p",
    model: over.model ?? "m",
    usage: over.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    content: over.content ?? [{ type: "text", text: "hi" }],
    timestamp: over.timeMs,
  },
});

const usageEntry = (over: {
  id: string;
  timeMs: number;
  provider: string;
  model: string;
  usage: UsageShape;
}): unknown => ({
  type: "usage",
  id: over.id,
  parentId: null,
  timestamp: new Date(over.timeMs).toISOString(),
  kind: "cache_warm",
  provider: over.provider,
  model: over.model,
  usage: over.usage,
});

const compactionEntry = (over: { id: string; timeMs: number; usage: UsageShape }): unknown => ({
  type: "compaction",
  id: over.id,
  parentId: null,
  timestamp: new Date(over.timeMs).toISOString(),
  summary: "summary",
  firstKeptEntryId: "x",
  tokensBefore: 0,
  usage: over.usage,
});

const entriesOf = (list: unknown[]): Parameters<typeof collectUsage>[0] =>
  list as Parameters<typeof collectUsage>[0];

/** 指定「几天前的某个整点」，本地时区（夏令时切换日也落在期望的日期上） */
const atDaysAgo = (days: number, hour: number, minute = 0): number => {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
};

describe("collectUsage", () => {
  it("assistant / usage / compaction 三类条目全部计入，合计为四类之和", () => {
    const result = collectUsage(
      entriesOf([
        assistantEntry({
          id: "a1",
          timeMs: 1000,
          usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 3 },
        }),
        usageEntry({
          id: "u1",
          timeMs: 2000,
          provider: "p",
          model: "m",
          usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0 },
        }),
        compactionEntry({
          id: "c1",
          timeMs: 3000,
          usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 },
        }),
      ]),
    );

    assert.deepEqual(result.totals, {
      inputTokens: 157,
      outputTokens: 33,
      cacheReadTokens: 5,
      cacheWriteTokens: 3,
      totalTokens: 198,
    });
  });

  it("同一模型的多次调用归并到同一模型键", () => {
    const result = collectUsage(
      entriesOf([
        assistantEntry({
          id: "a1",
          timeMs: 1000,
          usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0 },
        }),
        assistantEntry({
          id: "a2",
          timeMs: 2000,
          usage: { input: 20, output: 2, cacheRead: 0, cacheWrite: 0 },
        }),
      ]),
    );

    assert.equal(result.byModel.length, 1);
    assert.equal(result.byModel[0]?.model, "m");
    assert.equal(result.byModel[0]?.totals.inputTokens, 30);
    assert.equal(result.byModel[0]?.totals.totalTokens, 33);
  });

  it("since 只统计其后的条目", () => {
    const result = collectUsage(
      entriesOf([
        assistantEntry({
          id: "a1",
          timeMs: 1000,
          usage: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
        }),
        assistantEntry({
          id: "a2",
          timeMs: 3000,
          usage: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 },
        }),
      ]),
      2000,
    );

    assert.equal(result.totals.totalTokens, 5);
  });

  it("非法 / 缺失 usage 按 0 处理，不抛错", () => {
    const result = collectUsage(
      entriesOf([
        assistantEntry({ id: "a1", timeMs: 1000, usage: { input: "x", output: null } }),
        assistantEntry({ id: "a2", timeMs: 2000, usage: undefined, content: [] }),
      ]),
    );

    assert.equal(result.totals.totalTokens, 0);
  });

  it("工具调用按 assistant 消息的 toolCall 块计数", () => {
    const result = collectUsage(
      entriesOf([
        assistantEntry({
          id: "a1",
          timeMs: 1000,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
          content: [
            { type: "toolCall", id: "t1", name: "read", arguments: {} },
            { type: "text", text: "..." },
            { type: "toolCall", id: "t2", name: "grep", arguments: {} },
          ],
        }),
      ]),
    );

    assert.equal(result.toolCalls, 2);
  });
});

describe("UsageService", () => {
  let dir: string;
  let sourcePath: string;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "session-usage-"));
    const manager = SessionManager.create("/tmp/usage-project", dir, { id: "s1" });
    manager.appendMessage({
      role: "assistant",
      provider: "p",
      model: "m",
      usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
      content: [{ type: "text", text: "hi" }],
      api: "x",
      stopReason: "stop",
      timestamp: 1000,
    } as unknown as Parameters<typeof manager.appendMessage>[0]);
    const path = manager.getSessionFile();
    assert.ok(path, "会话应已落盘");
    sourcePath = path;
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
    id: "s1",
    name: "会话",
    cwd: "/tmp/usage-project",
    model: null,
    thinkingLevel: null,
    mode: "build",
    permissionMode: null,
    parentSessionId: null,
    agent: null,
    forkedFromId: null,
    goalState: null,
    childCount: 0,
    sourcePath,
    preview: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pinnedAt: null,
    lastReadAt: null,
    deletedAt: null,
    ...over,
  });

  const serviceWith = (
    records: SessionRecord[],
    contextWindow: number | null = 128000,
  ): UsageService =>
    new UsageService({ list: () => records } as unknown as SessionRepository, () => contextWindow);

  it("从会话文件聚合单会话用量", () => {
    const service = serviceWith([record()]);
    assert.equal(service.usageOf(record()).totalTokens, 12);
  });

  it("汇总按来源标注 kind，归档会话计入并带 deletedAt，无用量会话跳过", () => {
    const primary = record({ id: "s1", sourcePath });
    const subagent = record({ id: "sub1", parentSessionId: "s1", agent: "explore", sourcePath });
    const forked = record({ id: "f1", forkedFromId: "s1", sourcePath });
    const archived = record({
      id: "a1",
      sourcePath,
      deletedAt: "2026-02-01T00:00:00.000Z",
    });
    const empty = record({ id: "e1", sourcePath: null });

    const summary = serviceWith([primary, subagent, forked, archived, empty]).summary();

    const kinds = summary.bySession.map((entry) => entry.kind).sort();
    assert.deepEqual(kinds, ["forked", "primary", "primary", "subagent"]);
    assert.equal(summary.bySession.length, 4);
    // 归档会话仍计入总量，并带出归档标记供界面禁止打开
    assert.equal(summary.total.totalTokens, 48);
    assert.equal(
      summary.bySession.find((entry) => entry.sessionId === "a1")?.deletedAt,
      "2026-02-01T00:00:00.000Z",
    );
  });

  /** 会话在上下文基准测试里的用量：只用 input 计 token，便于按总量断言 */
  const usageShape = (totalTokens: number): UsageShape => ({
    input: totalTokens,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });

  /** 在独立目录里造一份只在本次用例里用的会话文件，避免污染共享 fixture 的 mtime 缓存 */
  const withSessionFile = (
    sessionId: string,
    build: (manager: SessionManager) => void,
  ): { target: SessionRecord; cleanup: () => void } => {
    const sessionDir = mkdtempSync(join(tmpdir(), "session-context-"));
    const manager = SessionManager.create("/tmp/usage-project", sessionDir, { id: sessionId });
    build(manager);
    const path = manager.getSessionFile();
    assert.ok(path, "会话应已落盘");
    return {
      target: record({ id: sessionId, sourcePath: path }),
      cleanup: () => rmSync(sessionDir, { recursive: true, force: true }),
    };
  };

  const appendAssistant = (
    manager: SessionManager,
    over: { timeMs: number; usage: UsageShape; stopReason?: string },
  ): void => {
    manager.appendMessage({
      role: "assistant",
      provider: "p",
      model: "m",
      usage: over.usage,
      content: [{ type: "text", text: "hi" }],
      api: "x",
      stopReason: over.stopReason ?? "stop",
      timestamp: over.timeMs,
    } as unknown as Parameters<typeof manager.appendMessage>[0]);
  };

  it("上下文占用取最近一次回答的用量，窗口由注入的解析器给出", () => {
    const service = serviceWith([record()]);
    // fixture 里唯一的一次回答：input 10 + output 2
    assert.deepEqual(service.contextUsageOf(record()), {
      tokens: 12,
      contextWindow: 128000,
      estimated: false,
    });
  });

  it("模型窗口不可知时给不出占用", () => {
    const service = serviceWith([record()], null);
    assert.equal(service.contextUsageOf(record()), null);
  });

  it("压缩后还没出新回答时占用未知，出新一轮回答后按新回答计算", () => {
    const compacted = withSessionFile("ctx-compacted", (manager) => {
      appendAssistant(manager, { timeMs: 1000, usage: usageShape(9000) });
      manager.appendCompaction("summary", null, 9000);
    });
    try {
      const service = serviceWith([compacted.target]);
      assert.equal(service.contextUsageOf(compacted.target), null);
    } finally {
      compacted.cleanup();
    }

    const answered = withSessionFile("ctx-answered", (manager) => {
      appendAssistant(manager, { timeMs: 1000, usage: usageShape(9000) });
      manager.appendCompaction("summary", null, 9000);
      appendAssistant(manager, { timeMs: 2000, usage: usageShape(200) });
    });
    try {
      const service = serviceWith([answered.target]);
      assert.equal(service.contextUsageOf(answered.target)?.tokens, 200);
    } finally {
      answered.cleanup();
    }
  });

  it("压缩后到新一轮回答之间用压缩结果的估算顶上，且标为估算", () => {
    const compacted = withSessionFile("ctx-estimated", (manager) => {
      appendAssistant(manager, { timeMs: 1000, usage: usageShape(9000) });
      manager.appendCompaction("summary", null, 9000);
    });
    try {
      const service = serviceWith([compacted.target]);
      service.rememberCompaction("ctx-estimated", 1500);

      assert.deepEqual(service.contextUsageOf(compacted.target), {
        tokens: 1500,
        contextWindow: 128000,
        estimated: true,
      });

      // 会话释放（归档 / 删除）后估算一并丢弃
      service.forget("ctx-estimated");
      assert.equal(service.contextUsageOf(compacted.target), null);
    } finally {
      compacted.cleanup();
    }
  });

  it("有实测回答时不采信压缩估算", () => {
    const answered = withSessionFile("ctx-measured", (manager) => {
      appendAssistant(manager, { timeMs: 1000, usage: usageShape(9000) });
      manager.appendCompaction("summary", null, 9000);
      appendAssistant(manager, { timeMs: 2000, usage: usageShape(200) });
    });
    try {
      const service = serviceWith([answered.target]);
      service.rememberCompaction("ctx-measured", 1500);

      assert.deepEqual(service.contextUsageOf(answered.target), {
        tokens: 200,
        contextWindow: 128000,
        estimated: false,
      });
    } finally {
      answered.cleanup();
    }
  });

  it("中断与出错的回答不算有效基准", () => {
    const aborted = withSessionFile("ctx-aborted", (manager) => {
      appendAssistant(manager, { timeMs: 1000, usage: usageShape(300) });
      appendAssistant(manager, {
        timeMs: 2000,
        usage: usageShape(500),
        stopReason: "aborted",
      });
    });
    try {
      const service = serviceWith([aborted.target]);
      assert.equal(service.contextUsageOf(aborted.target)?.tokens, 300);
    } finally {
      aborted.cleanup();
    }
  });

  it("会话未落盘时给不出占用", () => {
    const service = serviceWith([record({ sourcePath: null })]);
    assert.equal(service.contextUsageOf(record({ sourcePath: null })), null);
  });

  it("汇总带出逐日 / 逐周序列、峰值、连续天数与最长聊天时长", () => {
    // 今天 09:00 与 09:10 各一次调用（同一段聊天，10 分钟），昨天一次，40 天前一次
    const chat = withSessionFile("series-chat", (manager) => {
      appendAssistant(manager, { timeMs: atDaysAgo(0, 9), usage: usageShape(10) });
      appendAssistant(manager, { timeMs: atDaysAgo(0, 9, 10), usage: usageShape(10) });
    });
    const old = withSessionFile("series-old", (manager) => {
      appendAssistant(manager, { timeMs: atDaysAgo(1, 9), usage: usageShape(5) });
      appendAssistant(manager, { timeMs: atDaysAgo(40, 9), usage: usageShape(400) });
    });

    try {
      const summary = serviceWith([chat.target, old.target]).summary(30);

      assert.equal(summary.total.totalTokens, 25);
      assert.equal(summary.daily.length, 30);
      assert.equal(
        summary.daily.reduce((sum, day) => sum + day.totals.totalTokens, 0),
        summary.total.totalTokens,
      );
      assert.equal(
        summary.weekly.reduce((sum, week) => sum + week.totals.totalTokens, 0),
        summary.total.totalTokens,
      );
      // 周一为周起点：相邻两周的 weekStart 相差 7 天，且升序
      for (let i = 1; i < summary.weekly.length; i += 1) {
        const previous = summary.weekly[i - 1]?.weekStart ?? "";
        const current = summary.weekly[i]?.weekStart ?? "";
        assert.equal(
          Date.parse(`${current}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`),
          7 * 24 * 60 * 60 * 1000,
        );
      }
      assert.deepEqual(summary.peak, { date: localDateKeyOf(atDaysAgo(0, 9)), totalTokens: 20 });
      // 40 天前那次不进区间，但仍算活跃天；当前连续是今天 + 昨天两天
      assert.deepEqual(summary.streak, { current: 2, longest: 2, activeDays: 3 });
      assert.equal(summary.longestSessionMs, 10 * 60 * 1000);
      assert.equal(summary.bySession.length, 2);

      // 全部时间口径：逐日只含有活动的日子，总量把区间外的也算进来
      const all = serviceWith([chat.target, old.target]).summary();
      assert.equal(all.total.totalTokens, 425);
      assert.deepEqual(
        all.daily.map((day) => day.date),
        [...all.daily.map((day) => day.date)].sort(),
      );
      assert.equal(all.daily.length, 3);
      assert.equal(all.streak.activeDays, 3);
    } finally {
      chat.cleanup();
      old.cleanup();
    }
  });
});
