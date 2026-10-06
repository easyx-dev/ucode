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

  const serviceWith = (records: SessionRecord[]): UsageService =>
    new UsageService({ list: () => records } as unknown as SessionRepository);

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
});
