/** 活动面板视图模型单测：分组、最近一步派生与「胶囊是否出现」 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BackgroundService, GoalView } from "@ucode/contracts";

import type { GoalTurn } from "../goal-turns";
import { buildSessionActivity } from "../session-activity";
import type { ChatItem, SubagentStream } from "../types";

const itemOf = (role: ChatItem["role"], text: string, toolName?: string): ChatItem => ({
  id: `${role}-${text}-${toolName ?? ""}`,
  role,
  blocks: text ? [{ type: "text", text }] : [],
  ...(toolName ? { toolName } : {}),
});

const streamOf = (input: Partial<SubagentStream> & { items: ChatItem[] }): SubagentStream => ({
  sessionId: "sub-1",
  description: "调研",
  done: false,
  isError: false,
  ...input,
});

const serviceOf = (port: number): BackgroundService => ({
  id: String(port),
  command: `serve --port ${port}`,
  cwd: "/w",
  port,
  url: `http://127.0.0.1:${port}`,
  startedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
});

const goalOf = (status: GoalView["status"]): GoalView => ({
  objective: "把活动面板做完",
  status,
  cause: null,
  turns: 3,
  tokenBudget: 100_000,
  tokensUsed: 12_345,
  startedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  verification: null,
});

const empty = { subagents: {}, services: [], goal: null, goalTurns: [] };

describe("活动面板视图模型", () => {
  it("三块都空时不可见", () => {
    const view = buildSessionActivity(empty);
    assert.equal(view.visible, false);
    assert.deepEqual(view.subagents, []);
    assert.equal(view.goal, null);
  });

  it("进行中的子智能体排在已结束的前面，并派生出最近一步", () => {
    const view = buildSessionActivity({
      ...empty,
      subagents: {
        done1: streamOf({
          done: true,
          isError: true,
          items: [itemOf("assistant", "  做完了  ")],
        }),
        run1: streamOf({
          items: [itemOf("assistant", "先读代码"), itemOf("tool", "", "bash")],
        }),
      },
    });

    assert.deepEqual(
      view.subagents.map((item) => [item.toolCallId, item.status]),
      [
        ["run1", "running"],
        ["done1", "failed"],
      ],
    );
    assert.equal(view.runningSubagents, 1);
    assert.equal(view.visible, true);
    // 工具条目报工具名，正文条目取正文并折叠空白
    assert.equal(view.subagents[0]?.latest, "bash");
    assert.equal(view.subagents[1]?.latest, "做完了");
  });

  it("子智能体没有可用条目时最近一步为空", () => {
    const view = buildSessionActivity({
      ...empty,
      subagents: { run1: streamOf({ items: [] }) },
    });
    assert.equal(view.subagents[0]?.latest, "");
  });

  it("后台服务直接进清单（探不到的已由服务端移除）", () => {
    const view = buildSessionActivity({
      ...empty,
      services: [serviceOf(5173), serviceOf(3000)],
    });

    assert.deepEqual(
      view.services.map((service) => service.port),
      [5173, 3000],
    );
    assert.equal(view.visible, true);
  });

  it("已完成的目标不算活动，进行中的才算并带上最近一轮结论", () => {
    const turns: GoalTurn[] = [
      { key: "a", kind: "kickoff", text: "开工" },
      { key: "b", kind: "continuation", turn: 1, text: "继续", outcome: { event: "verdict" } },
    ];

    const done = buildSessionActivity({ ...empty, goal: goalOf("completed"), goalTurns: turns });
    assert.equal(done.goalActive, false);
    assert.equal(done.goal, null);
    assert.equal(done.visible, false);

    const active = buildSessionActivity({ ...empty, goal: goalOf("active"), goalTurns: turns });
    assert.equal(active.visible, true);
    assert.equal(active.goal?.turns, 3);
    assert.equal(active.goal?.latestTurn?.key, "b");
    assert.equal(active.goal?.status, "active");
  });
});
