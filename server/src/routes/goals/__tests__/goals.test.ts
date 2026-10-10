/**
 * /api/v1/goals 路由集成：真 `GoalService` + 假仓储 / 假用量 / 真事件总线，池用桩。
 *
 * 只验路由层的准入与 patch 语义（子会话 / 模式 / 忙碌 / 无目标），不触真实装配与模型。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE_PATH, ERROR_CODES, type GoalView } from "@ucode/contracts";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { Services } from "../../../app";
import { SessionEventBus } from "../../../core/event-bus";
import type { SessionRecord, SessionRepository } from "../../../db/session-repository";
import { GoalService } from "../../../harness/goal";
import {
  type GoalState,
  parseGoalState,
  pauseGoal,
  serializeGoalState,
  startGoal,
} from "../../../harness/goal/state";
import type { UsageService } from "../../../harness/usage";
import { AppError, fail } from "../../../lib/response";
import { createGoalsRoute } from "../index";

const VERIFICATION = { achieved: true, reason: "已完成", nextStep: "", at: "t" };

const makeApp = (options: {
  mode?: string;
  child?: boolean;
  goal?: GoalState | null;
  active?: boolean;
}) => {
  let stored = options.goal ? serializeGoalState(options.goal) : null;
  let active = options.active ?? false;
  // 起轮失败：用来验「目标不会被停在 active、也不会被换回上一个」
  let admitFails = false;
  const disposed: string[] = [];

  const record: SessionRecord = {
    id: "s1",
    name: null,
    cwd: "/tmp/project",
    model: null,
    thinkingLevel: null,
    mode: options.mode ?? "build",
    permissionMode: null,
    parentSessionId: options.child ? "parent" : null,
    agent: options.child ? "explore" : null,
    forkedFromId: null,
    goalState: stored,
    childCount: 0,
    sourcePath: null,
    preview: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pinnedAt: null,
    lastReadAt: null,
    deletedAt: null,
  };

  const sessions = {
    find: (id: string) => (id === "s1" ? { ...record, goalState: stored } : undefined),
    setGoal: (id: string, next: string | null) => {
      if (id === "s1") stored = next;
    },
  } as unknown as SessionRepository;

  const usage = { usageOf: () => ({ totalTokens: 0 }) } as unknown as UsageService;
  const events = new SessionEventBus();
  const goals = new GoalService(sessions, usage, events);

  // 起轮会真的去装配会话，这里只记下「有没有被要求起轮」与「起轮前有没有重装」
  const started: string[] = [];
  const session = {} as never;
  const pool = {
    isActive: () => active,
    get: () => undefined,
    dispose: (id: string) => {
      disposed.push(id);
      return true;
    },
    abort: async () => true,
    withLock: async <T>(_id: string, fn: () => Promise<T>) => fn(),
    ensure: async () => {
      if (admitFails) throw new AppError(ERROR_CODES.internal, "会话装配失败", 500);
      return session;
    },
    startInjectedRun: () => {
      started.push("run");
    },
  };

  const services = {
    runtime: { getStatus: () => ({ configured: true }) },
    sessions,
    goals,
    pool,
    events,
  } as unknown as Services;

  const app = new Hono();
  app.route(`${API_BASE_PATH}/goals`, createGoalsRoute(services));
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        fail(error.code, error.message, error.details, error.params),
        error.status as ContentfulStatusCode,
      );
    }
    throw error;
  });

  const post = (path: string, body: unknown) =>
    app.request(`${API_BASE_PATH}/goals/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    post,
    state: (): GoalState | null => parseGoalState(stored),
    disposed,
    started,
    setActive: (value: boolean): void => {
      active = value;
    },
    failAdmit: (value: boolean): void => {
      admitFails = value;
    },
  };
};

const goalOf = async (response: Response): Promise<GoalView | null> => {
  const body = (await response.json()) as { data: { goal: GoalView | null } };
  return body.data.goal;
};

describe("goals 路由准入", () => {
  it("plan / ask 模式不允许设置目标", async () => {
    for (const mode of ["plan", "ask"]) {
      const env = makeApp({ mode });
      const response = await env.post("set", { sessionId: "s1", objective: "把测试跑通" });
      assert.equal(response.status, 400, `${mode} 模式应被拒`);
    }
  });

  it("会话运行中设置目标被拒（409）", async () => {
    const env = makeApp({ active: true });
    const response = await env.post("set", { sessionId: "s1", objective: "把测试跑通" });
    assert.equal(response.status, 409);
    assert.equal(env.state(), null, "被拒时不该落目标");
  });

  it("子会话在六个接口上一律 400", async () => {
    const env = makeApp({ child: true, goal: startGoal("目标", null) });
    const calls: Array<[string, unknown]> = [
      ["set", { sessionId: "s1", objective: "换个目标" }],
      ["status", { sessionId: "s1" }],
      ["budget", { sessionId: "s1", tokenBudget: 100 }],
      ["pause", { sessionId: "s1" }],
      ["resume", { sessionId: "s1" }],
      ["clear", { sessionId: "s1" }],
    ];
    for (const [path, body] of calls) {
      const response = await env.post(path, body);
      assert.equal(response.status, 400, `${path} 应拒子会话`);
    }
  });

  it("会话不存在返回 404", async () => {
    const env = makeApp({ goal: startGoal("目标", null) });
    for (const path of ["status", "budget", "pause", "resume", "clear"]) {
      const body =
        path === "budget" ? { sessionId: "nope", tokenBudget: 100 } : { sessionId: "nope" };
      assert.equal((await env.post(path, body)).status, 404, `${path} 应 404`);
    }
    assert.equal((await env.post("set", { sessionId: "nope", objective: "目标" })).status, 404);
  });
});

describe("goals 路由行为", () => {
  it("设置目标后落库，并在起轮前重装会话（目标是工具注册的条件）", async () => {
    const env = makeApp({});
    const response = await env.post("set", { sessionId: "s1", objective: "把测试跑通" });
    assert.equal(response.status, 200);
    assert.equal((await goalOf(response))?.objective, "把测试跑通");
    assert.equal(env.state()?.status, "active");
    assert.deepEqual(env.disposed, ["s1"]);
    assert.deepEqual(env.started, ["run"]);
  });

  it("改预算只动上限，轮数与校验结果不变", async () => {
    const before = {
      ...startGoal("目标", 100),
      turns: 3,
      verification: VERIFICATION,
    };
    const env = makeApp({ goal: before });
    const response = await env.post("budget", { sessionId: "s1", tokenBudget: 500 });
    assert.equal(response.status, 200);
    const goal = await goalOf(response);
    assert.equal(goal?.tokenBudget, 500);
    assert.equal(goal?.turns, 3);
    assert.equal(goal?.verification?.reason, "已完成");
    assert.equal(env.state()?.id, before.id, "身份 id 不轮换");
    assert.deepEqual(env.disposed, [], "改预算不起轮，也不重装");
  });

  it("传 null 即取消上限", async () => {
    const env = makeApp({ goal: startGoal("目标", 100) });
    const response = await env.post("budget", { sessionId: "s1", tokenBudget: null });
    assert.equal(response.status, 200);
    assert.equal((await goalOf(response))?.tokenBudget, null);
  });

  it("无目标时改预算 400", async () => {
    const env = makeApp({});
    const response = await env.post("budget", { sessionId: "s1", tokenBudget: 100 });
    assert.equal(response.status, 400);
  });

  it("目标已完成时改预算 400", async () => {
    const env = makeApp({
      goal: { ...startGoal("目标", 100), status: "completed", verification: VERIFICATION },
    });
    const response = await env.post("budget", { sessionId: "s1", tokenBudget: 500 });
    assert.equal(response.status, 400);
    assert.equal(env.state()?.tokenBudget, 100, "被拒时不改上限");
  });

  it("清除后目标为空", async () => {
    const env = makeApp({ goal: startGoal("目标", null) });
    const response = await env.post("clear", { sessionId: "s1" });
    assert.equal(response.status, 200);
    assert.equal(await goalOf(response), null);
    assert.equal(env.state(), null);
  });

  it("恢复时重装会话并起恢复轮", async () => {
    const env = makeApp({ goal: startGoal("目标", null) });
    await env.post("pause", { sessionId: "s1" });
    const response = await env.post("resume", { sessionId: "s1" });
    assert.equal(response.status, 200);
    assert.equal((await goalOf(response))?.status, "active");
    assert.deepEqual(env.disposed, ["s1"]);
    assert.deepEqual(env.started, ["run"]);
  });

  it("目标已完成时恢复不再起轮", async () => {
    const env = makeApp({
      goal: { ...startGoal("目标", null), status: "completed", verification: VERIFICATION },
    });
    const response = await env.post("resume", { sessionId: "s1" });
    assert.equal(response.status, 200);
    assert.equal((await goalOf(response))?.status, "completed");
    assert.deepEqual(env.started, []);
  });
});

describe("起轮失败", () => {
  it("替换目标时起轮失败：保留新目标并暂停，不把目标换回上一个", async () => {
    // 旧目标仍是 active（如刚重启过服务、还没在跑），此时替换最容易被旧快照盖回去
    const env = makeApp({ goal: startGoal("旧目标", null) });
    env.failAdmit(true);
    const response = await env.post("set", { sessionId: "s1", objective: "新目标" });
    assert.equal(response.status, 500);
    assert.equal(env.state()?.objective, "新目标");
    assert.equal(env.state()?.status, "paused");
    assert.equal(env.state()?.cause, "error");
  });

  it("首次设定目标时起轮失败：暂停保留，不留在 active", async () => {
    const env = makeApp({});
    env.failAdmit(true);
    const response = await env.post("set", { sessionId: "s1", objective: "新目标" });
    assert.equal(response.status, 500);
    assert.equal(env.state()?.objective, "新目标");
    assert.equal(env.state()?.status, "paused");
    assert.equal(env.state()?.cause, "error");
  });

  it("恢复时起轮失败：回到暂停，不留在 active", async () => {
    const env = makeApp({ goal: pauseGoal(startGoal("目标", null), "user") });
    env.failAdmit(true);
    const response = await env.post("resume", { sessionId: "s1" });
    assert.equal(response.status, 500);
    assert.equal(env.state()?.status, "paused");
    assert.equal(env.state()?.cause, "error");
  });
});
