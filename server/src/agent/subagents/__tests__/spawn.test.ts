/**
 * 子会话 spawn 单测：建行字段、取最终文本、错误归一、失败清理与回收。
 *
 * 用假的 AgentSession 替代真实会话，避免依赖模型与网络。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { SessionRecord } from "../../../db/session-repository";
import { type SubagentSpawnDeps, spawnSubagent } from "../spawn";

const parentRecord: SessionRecord = {
  id: "parent-1",
  name: null,
  cwd: "/tmp/project",
  model: null,
  thinkingLevel: null,
  mode: "build",
  parentSessionId: null,
  agent: null,
  childCount: 0,
  sourcePath: null,
  preview: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const assistantEntry = (text: string) => ({
  type: "message",
  id: "e1",
  parentId: null,
  timestamp: "2026-01-01T00:00:01.000Z",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

/** 只有工具调用、没有正文的 assistant 条目（末条常见于中止 / 达上限） */
const emptyAssistantEntry = {
  type: "message",
  id: "e2",
  parentId: "e1",
  timestamp: "2026-01-01T00:00:02.000Z",
  message: { role: "assistant", content: [] },
};

type FakeChild = { session: AgentSession; aborted: () => boolean };

const fakeChild = (
  behavior: { entries?: unknown[]; prompt?: () => Promise<void> } = {},
): FakeChild => {
  let aborted = false;
  const session = {
    sessionManager: { getEntries: () => behavior.entries ?? [] },
    prompt: behavior.prompt ?? (async () => {}),
    abort: async () => {
      aborted = true;
    },
  } as unknown as AgentSession;
  return { session, aborted: () => aborted };
};

const depsOf = (over: Partial<SubagentSpawnDeps> = {}): SubagentSpawnDeps => ({
  createChild: () => {},
  discardChild: () => {},
  ensure: async () => assert.fail("未提供 ensure"),
  refresh: () => {},
  settleInteractions: () => {},
  dispose: () => {},
  emit: () => {},
  ...over,
});

describe("spawnSubagent", () => {
  it("建出子会话行，返回最后一条有正文的 assistant 文本，并回写 / 结算 / 回收", async () => {
    const { session } = fakeChild({ entries: [assistantEntry("结论 A"), emptyAssistantEntry] });
    const created: Array<Record<string, unknown>> = [];
    const events: string[] = [];

    const result = await spawnSubagent(
      {
        parent: parentRecord,
        toolCallId: "call-test",
        cwd: "/tmp/project",
        request: { description: "侦察影响面", task: "看看谁调用了它" },
      },
      depsOf({
        createChild: (_id, input) => created.push(input as unknown as Record<string, unknown>),
        ensure: async () => session,
        refresh: (id) => events.push(`refresh:${id}`),
        settleInteractions: (id) => events.push(`settle:${id}`),
        dispose: (id) => events.push(`dispose:${id}`),
      }),
    );

    assert.match(result.sessionId, /^sub-/);
    assert.equal(result.text, "结论 A", "末条无正文时应往前找");
    assert.equal(created.length, 1);
    assert.equal(created[0]?.parentId, "parent-1");
    assert.equal(created[0]?.cwd, "/tmp/project");
    assert.equal(created[0]?.agent, "general");
    assert.equal(created[0]?.name, "侦察影响面");
    assert.deepEqual(events, [
      `refresh:${result.sessionId}`,
      `settle:${result.sessionId}`,
      `dispose:${result.sessionId}`,
    ]);
  });

  it("未知角色在建行前报错", async () => {
    await assert.rejects(
      spawnSubagent(
        {
          parent: parentRecord,
          toolCallId: "call-test",
          cwd: "/tmp/project",
          request: { agent: "nope", description: "x", task: "y" },
        },
        depsOf({ createChild: () => assert.fail("不应建行") }),
      ),
      /未知的子智能体角色/,
    );
  });

  it("装配失败时删掉刚建的空行并抛出原错误", async () => {
    const discarded: string[] = [];

    await assert.rejects(
      spawnSubagent(
        {
          parent: parentRecord,
          toolCallId: "call-test",
          cwd: "/tmp/project",
          request: { description: "x", task: "y" },
        },
        depsOf({
          discardChild: (id) => discarded.push(id),
          ensure: async () => {
            throw new Error("模型未配置");
          },
        }),
      ),
      /模型未配置/,
    );
    assert.equal(discarded.length, 1, "装配失败应删除刚建的行");
    assert.match(discarded[0] ?? "", /^sub-/);
  });

  it("中止信号会中止子会话、抛可读错误，并在失败路径回写 / 结算", async () => {
    const { session, aborted } = fakeChild({ prompt: () => new Promise<void>(() => {}) });
    const controller = new AbortController();
    const events: string[] = [];

    const pending = spawnSubagent(
      {
        parent: parentRecord,
        toolCallId: "call-test",
        cwd: "/tmp/project",
        request: { description: "长任务", task: "慢慢做" },
        signal: controller.signal,
      },
      depsOf({
        ensure: async () => session,
        refresh: () => events.push("refresh"),
        settleInteractions: () => events.push("settle"),
      }),
    );
    controller.abort();

    await assert.rejects(pending, /中止/);
    assert.equal(aborted(), true, "中止时应调用 AgentSession.abort");
    assert.deepEqual(events, ["refresh", "settle"], "失败路径也要回写与结算");
  });

  it("子会话内部报错归一为可读文案", async () => {
    const { session } = fakeChild({
      prompt: () => Promise.reject(new Error("upstream 500 boom")),
    });

    await assert.rejects(
      spawnSubagent(
        {
          parent: parentRecord,
          toolCallId: "call-test",
          cwd: "/tmp/project",
          request: { description: "x", task: "y" },
        },
        depsOf({ ensure: async () => session }),
      ),
      /子智能体执行失败：upstream 500 boom/,
    );
  });

  it("只发关联帧：start 在 prompt 前、end 在 prompt 后且 isError=false", async () => {
    const emits: Array<[string, Record<string, unknown>]> = [];
    const order: string[] = [];
    const { session } = fakeChild({
      entries: [assistantEntry("结论")],
      prompt: async () => {
        order.push("prompt");
      },
    });

    const result = await spawnSubagent(
      {
        parent: parentRecord,
        toolCallId: "call-abc",
        cwd: "/tmp/project",
        request: { description: "侦察", task: "看" },
      },
      depsOf({
        ensure: async () => session,
        emit: (type, data) => {
          emits.push([type, data]);
          order.push(type);
        },
      }),
    );

    assert.deepEqual(
      emits.map(([type]) => type),
      ["subagent_start", "subagent_end"],
    );
    assert.equal(emits[0]?.[1]?.toolCallId, "call-abc");
    assert.equal(emits[0]?.[1]?.sessionId, result.sessionId);
    assert.equal(emits[0]?.[1]?.description, "侦察");
    assert.equal(emits[1]?.[1]?.isError, false);
    assert.deepEqual(order, ["subagent_start", "prompt", "subagent_end"]);
  });

  it("失败路径的 end 标记 isError", async () => {
    const emits: Array<[string, Record<string, unknown>]> = [];
    const { session } = fakeChild({ prompt: () => Promise.reject(new Error("boom")) });

    await assert.rejects(
      spawnSubagent(
        {
          parent: parentRecord,
          toolCallId: "call-1",
          cwd: "/tmp/project",
          request: { description: "x", task: "y" },
        },
        depsOf({
          ensure: async () => session,
          emit: (type, data) => emits.push([type, data]),
        }),
      ),
      /子智能体执行失败/,
    );
    assert.equal(emits.at(-1)?.[0], "subagent_end");
    assert.equal(emits.at(-1)?.[1]?.isError, true);
  });

  it("装配失败或未知角色时不发任何关联帧", async () => {
    const emits: string[] = [];

    await assert.rejects(
      spawnSubagent(
        {
          parent: parentRecord,
          toolCallId: "call-1",
          cwd: "/tmp/project",
          request: { description: "x", task: "y" },
        },
        depsOf({
          ensure: async () => {
            throw new Error("模型未配置");
          },
          emit: (type) => emits.push(type),
        }),
      ),
      /模型未配置/,
    );
    await assert.rejects(
      spawnSubagent(
        {
          parent: parentRecord,
          toolCallId: "call-2",
          cwd: "/tmp/project",
          request: { agent: "nope", description: "x", task: "y" },
        },
        depsOf({ emit: (type) => emits.push(type) }),
      ),
      /未知的子智能体角色/,
    );
    assert.deepEqual(emits, []);
  });
});
