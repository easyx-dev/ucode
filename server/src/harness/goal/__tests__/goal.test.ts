/**
 * 目标模式的单测：状态机、校验输出解析与落定后的止损判定。
 *
 * 校验判定用假运行时喂固定 JSON，不依赖真实模型；落定逻辑用假仓储 / 假用量驱动。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { GOAL_MAX_OBJECTIVE_LENGTH, GOAL_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { SessionEventBus } from "../../../core/event-bus";
import type { SessionRecord, SessionRepository } from "../../../db/session-repository";
import type { UsageService } from "../../usage";
import { GoalService } from "../index";
import {
  advanceTurn,
  completeGoal,
  parseGoalState,
  pauseGoal,
  resumeGoal,
  serializeGoalState,
  startGoal,
} from "../state";
import { lastAssistantActivity, lastAssistantStopReason, parseGoalVerdict } from "../verify";

type SessionMessage = AgentSession["messages"][number];

const asMessages = (
  items: Array<{ role: string; content: unknown; stopReason?: string }>,
): SessionMessage[] => items as unknown as SessionMessage[];

const textMessage = (
  text: string,
  stopReason = "stop",
): { role: string; content: unknown; stopReason: string } => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason,
});

const toolMessage = (name = "bash"): { role: string; content: unknown; stopReason: string } => ({
  role: "assistant",
  content: [{ type: "toolCall", id: "t1", name, arguments: {} }],
  stopReason: "toolUse",
});

describe("目标状态机", () => {
  it("设定后为 active，轮数与计数归零", () => {
    const state = startGoal("把测试跑通", 1000);
    assert.equal(state.status, "active");
    assert.equal(state.cause, null);
    assert.equal(state.turns, 0);
    assert.equal(state.noProgress, 0);
    assert.equal(state.tokenBudget, 1000);
    assert.equal(state.verification, null);
  });

  it("暂停 / 恢复 / 完成 / 续跑轮数递增", () => {
    const base = startGoal("目标", null);
    const paused = pauseGoal(base, "user");
    assert.equal(paused.status, "paused");
    assert.equal(paused.cause, "user");
    const resumed = resumeGoal(paused);
    assert.equal(resumed.status, "active");
    assert.equal(resumed.cause, null);
    const advanced = advanceTurn(advanceTurn(base));
    assert.equal(advanced.turns, 2);
    const done = completeGoal(base, { achieved: true, reason: "ok", nextStep: "", at: "t" });
    assert.equal(done.status, "completed");
    assert.equal(done.cause, null);
  });

  it("序列化往返一致，非法结构按无目标处理", () => {
    const state = startGoal("往返", null);
    assert.deepEqual(parseGoalState(serializeGoalState(state)), state);
    assert.equal(parseGoalState(null), null);
    assert.equal(parseGoalState("{"), null);
    assert.equal(parseGoalState(JSON.stringify({ status: "active" })), null);
    assert.equal(
      parseGoalState(JSON.stringify({ ...state, status: "unknown" })),
      null,
      "未登记的状态应判为无目标",
    );
  });

  it("目标描述上限与契约一致", () => {
    assert.equal(startGoal("x".repeat(GOAL_MAX_OBJECTIVE_LENGTH), null).objective.length, 4000);
  });
});

describe("校验输出解析", () => {
  it("合法 JSON（含代码块包裹）可解析", () => {
    assert.deepEqual(
      parseGoalVerdict(
        '```json\n{"achieved": false, "reason": "还差测试", "nextStep": "跑测试"}\n```',
      ),
      { achieved: false, reason: "还差测试", nextStep: "跑测试" },
    );
    assert.deepEqual(parseGoalVerdict('{"achieved": true}'), {
      achieved: true,
      reason: "",
      nextStep: "",
    });
  });

  it("缺少 achieved 或非 JSON 时返回 null", () => {
    assert.equal(parseGoalVerdict("没有结论"), null);
    assert.equal(parseGoalVerdict('{"reason": "x"}'), null);
    assert.equal(parseGoalVerdict("{不是合法 JSON}"), null);
  });
});

describe("落定活动判定", () => {
  it("取最后一条 assistant 的结束原因", () => {
    assert.equal(
      lastAssistantStopReason(
        asMessages([
          { role: "assistant", content: [], stopReason: "stop" },
          { role: "user", content: "继续" },
        ]),
      ),
      "stop",
    );
    assert.equal(lastAssistantStopReason(asMessages([{ role: "user", content: "hi" }])), undefined);
  });

  it("区分有无工具调用，正文做规范化", () => {
    assert.deepEqual(lastAssistantActivity(asMessages([toolMessage()])), {
      toolCalls: 1,
      text: "",
    });
    assert.deepEqual(lastAssistantActivity(asMessages([textMessage("  你好\n世界 ")])), {
      toolCalls: 0,
      text: "你好 世界",
    });
  });
});

describe("GoalService 落定处理", () => {
  const makeService = (options: {
    state: ReturnType<typeof startGoal> | null;
    tokensUsed?: number;
    verdict?: string;
    messages?: SessionMessage[];
    verify?: () => Promise<{ content: unknown }>;
  }) => {
    let stored = options.state ? serializeGoalState(options.state) : null;
    const record: SessionRecord = {
      id: "s1",
      name: null,
      cwd: "/tmp/project",
      model: null,
      thinkingLevel: null,
      mode: "build",
      permissionMode: null,
      parentSessionId: null,
      agent: null,
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
    const repository = {
      find: () => ({ ...record, goalState: stored }),
      setGoal: (_id: string, next: string | null) => {
        stored = next;
      },
    } as unknown as SessionRepository;
    const usage = {
      usageOf: () => ({ totalTokens: options.tokensUsed ?? 0 }),
    } as unknown as UsageService;
    const events = new SessionEventBus();
    const frames: Array<unknown> = [];
    events.subscribe((frame) => frames.push(frame));
    const service = new GoalService(repository, usage, events);

    // 追加到会话文件的观测条目：断言「状态变迁有没有落盘」用
    const entries: Array<{ customType: string; data: Record<string, unknown> }> = [];
    const session = {
      sessionManager: {
        appendCustomEntry: (customType: string, data: Record<string, unknown>) => {
          entries.push({ customType, data });
          return `e${entries.length}`;
        },
      },
      messages: options.messages ?? [],
      model: { provider: "p", id: "m" },
      modelRuntime: {
        completeSimple:
          options.verify ??
          (async () => ({
            content: [{ type: "text", text: options.verdict ?? '{"achieved": false}' }],
          })),
      },
    } as unknown as AgentSession;

    return { service, session, state: () => parseGoalState(stored), frames, entries };
  };

  it("达成时标记 completed 且不续跑，并留下一条目标记录", async () => {
    const { service, session, state, entries } = makeService({
      state: startGoal("目标", null),
      verdict: '{"achieved": true, "reason": "已完成", "nextStep": ""}',
    });
    const outcome = await service.onSettled("s1", session);
    assert.equal(outcome, null);
    assert.equal(state()?.status, "completed");
    assert.equal(state()?.verification?.reason, "已完成");

    assert.equal(entries.length, 1, "完成要落一条记录");
    assert.equal(entries[0]?.customType, GOAL_RECORD_CUSTOM_TYPE);
    assert.equal(entries[0]?.data.event, "completed");
    assert.equal(entries[0]?.data.status, "completed");
    assert.deepEqual(entries[0]?.data.verdict, {
      achieved: true,
      reason: "已完成",
      nextStep: "",
    });
  });

  it("每轮校验结论与暂停原因都落一条记录（文件里可回溯）", async () => {
    const running = makeService({
      state: startGoal("目标", null),
      messages: asMessages([toolMessage()]),
    });
    await running.service.onSettled("s1", running.session);
    assert.equal(running.entries[0]?.data.event, "verdict");
    const verdict = running.entries[0]?.data.verdict as { achieved?: boolean } | undefined;
    assert.equal(verdict?.achieved, false);

    const paused = makeService({
      state: { ...startGoal("目标", null), turns: 25 },
      messages: asMessages([toolMessage()]),
    });
    await paused.service.onSettled("s1", paused.session);
    // 先落校验结论，再落暂停：两条都在文件里，顺序即时间顺序
    assert.deepEqual(
      paused.entries.map((entry) => entry.data.event),
      ["verdict", "pause"],
    );
    assert.equal(paused.entries[1]?.data.cause, "limit");
  });

  it("未达成且有工具调用时递增轮数并续跑", async () => {
    const { service, session, state } = makeService({
      state: startGoal("目标", null),
      messages: asMessages([toolMessage()]),
    });
    const outcome = await service.onSettled("s1", session);
    assert.ok(outcome && "continue" in outcome);
    assert.equal(state()?.status, "active");
    assert.equal(state()?.turns, 1);
    assert.equal(state()?.noProgress, 0);
  });

  it("连续三轮无工具调用触发无进展暂停", async () => {
    const { service, session, state } = makeService({
      state: startGoal("目标", null),
      messages: asMessages([textMessage("没有进展")]),
    });
    for (let i = 0; i < 3; i += 1) await service.onSettled("s1", session);
    assert.equal(state()?.status, "paused");
    assert.equal(state()?.cause, "no_progress");
  });

  it("达到轮数上限时暂停", async () => {
    const { service, session, state } = makeService({
      state: { ...startGoal("目标", null), turns: 25 },
      messages: asMessages([toolMessage()]),
    });
    await service.onSettled("s1", session);
    assert.equal(state()?.status, "paused");
    assert.equal(state()?.cause, "limit");
  });

  it("达到 token 预算时暂停", async () => {
    const { service, session, state } = makeService({
      state: startGoal("目标", 100),
      tokensUsed: 120,
      messages: asMessages([toolMessage()]),
    });
    await service.onSettled("s1", session);
    assert.equal(state()?.status, "paused");
    assert.equal(state()?.cause, "budget");
  });

  it("被中断的轮次暂停且不校验续跑", async () => {
    const { service, session, state } = makeService({
      state: startGoal("目标", null),
      messages: asMessages([textMessage("半截", "aborted")]),
    });
    const outcome = await service.onSettled("s1", session);
    assert.equal(outcome, null);
    assert.equal(state()?.status, "paused");
    assert.equal(state()?.cause, "interrupted");
  });

  it("非 active 目标不再续跑", async () => {
    const { service, session } = makeService({ state: pauseGoal(startGoal("目标", null), "user") });
    assert.equal(await service.onSettled("s1", session), null);
  });

  // 校验是一次网络调用，期间目标可能被替换 / 清除；迟到的旧结果必须作废
  const gatedVerdict = (text: string) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      release: () => release(),
      verify: async () => {
        await gate;
        return { content: [{ type: "text", text }] };
      },
    };
  };

  it("校验期间清除目标时丢弃迟到的旧结果", async () => {
    const gated = gatedVerdict('{"achieved": true}');
    const { service, session, state } = makeService({
      state: startGoal("目标", null),
      verify: gated.verify,
    });
    const pending = service.onSettled("s1", session);
    service.clear({ id: "s1" } as SessionRecord);
    gated.release();
    assert.equal(await pending, null);
    assert.equal(state(), null, "清除后不应被旧校验结果复活");
  });

  it("校验期间替换目标时保留新目标、丢弃旧结果", async () => {
    const gated = gatedVerdict('{"achieved": true, "reason": "旧"}');
    const { service, session, state } = makeService({
      state: startGoal("旧目标", null),
      verify: gated.verify,
    });
    const pending = service.onSettled("s1", session);
    service.set({ id: "s1" } as SessionRecord, { objective: "新目标", tokenBudget: null });
    gated.release();
    assert.equal(await pending, null);
    assert.equal(state()?.objective, "新目标");
    assert.equal(state()?.status, "active");
  });
});
