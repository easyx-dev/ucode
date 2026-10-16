/**
 * 生成阶段推演：四段的进出、等用户的叠加与分段累计。
 *
 * 这里锁的是「哪些帧会换阶段、哪些只改记账」——阶段推错不会报错，只会让界面把排队时间报成生成时间、
 * 或把等用户报成工具慢，所以逐条钉住：只有请求的边界与交互的起止才动状态。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServerEventPayload } from "@ucode/contracts";
import {
  advancePhase,
  type PhaseKind,
  type StepSegments,
  type StreamPhase,
  stepBreakdown,
} from "../phase";

const frameOf = (type: string, data: unknown = {}): ServerEventPayload =>
  ({ type, sessionId: "s1", seq: 1, data }) as ServerEventPayload;

/** 空的分段累计：断言里拼期望值时用 */
const NO_SEG: StepSegments = { response: 0, firstToken: 0, streaming: 0, tool: 0, userWait: 0 };

/** 期望的阶段：默认是「新起一段、没有工具、不在等用户」 */
const phaseOf = (
  kind: PhaseKind,
  startedAt: number,
  extra: Partial<StreamPhase> = {},
): StreamPhase => ({
  kind,
  startedAt,
  segments: NO_SEG,
  tools: [],
  waiting: null,
  ...extra,
});

describe("advancePhase", () => {
  it("服务端的 step_start 起表并归零分段：非本端发起的轮次（批准计划 / 目标续跑）也报得出排队那段", () => {
    assert.deepEqual(
      advancePhase(null, frameOf("step_start"), 800),
      phaseOf("waitingResponse", 800),
    );

    // 上一步的分段与遗留的等待不带进新的一步
    const previous = phaseOf("tool", 1, {
      segments: { response: 10, firstToken: 20, streaming: 30, tool: 40, userWait: 50 },
      tools: [{ id: "t1", name: "bash" }],
      waiting: { kind: "permission", since: 2 },
    });
    assert.deepEqual(
      advancePhase(previous, frameOf("step_start"), 900),
      phaseOf("waitingResponse", 900),
    );
  });

  it("响应头到达才离开等待：只有 assistant 消息算，用户消息与工具结果不算", () => {
    assert.equal(advancePhase(null, frameOf("message_start", { role: "user" }), 500), null);
    assert.equal(advancePhase(null, frameOf("message_start", { role: "toolResult" }), 500), null);
    assert.deepEqual(
      advancePhase(null, frameOf("message_start", { role: "assistant" }), 500),
      phaseOf("waitingFirstToken", 500),
    );
  });

  it("首个内容帧起报生成，同一段生成里的后续增量不再重置起点", () => {
    const started = advancePhase(
      phaseOf("waitingFirstToken", 100),
      frameOf("thinking_delta", { delta: "嗯" }),
      200,
    );

    assert.deepEqual(
      started,
      phaseOf("streaming", 200, { segments: { ...NO_SEG, firstToken: 100 } }),
    );
    assert.equal(advancePhase(started, frameOf("text_delta", { delta: "答" }), 300), started);
    assert.equal(advancePhase(started, frameOf("thinking_delta", { delta: "再想" }), 400), started);
  });

  it("没等到响应头就来的内容帧也能起报生成（重连后只剩增量帧）", () => {
    assert.deepEqual(
      advancePhase(null, frameOf("text_delta", { delta: "答" }), 7),
      phaseOf("streaming", 7),
    );
  });

  it("消息结束回到等待下一次请求：`message_end` 之后要么跑工具、要么就是下一次排队", () => {
    const settled = advancePhase(
      phaseOf("streaming", 1),
      frameOf("message_end", { role: "assistant" }),
      90,
    );

    assert.deepEqual(
      settled,
      phaseOf("waitingResponse", 90, { segments: { ...NO_SEG, streaming: 89 } }),
    );
    assert.equal(
      advancePhase(settled, frameOf("message_end", { role: "toolResult" }), 95),
      settled,
      "工具结果的落盘不是一次往返的结束",
    );
  });

  it("分段按阶段累计：一步走完是等待响应 / 首帧 / 生成 / 工具四段", () => {
    let phase: StreamPhase | null = advancePhase(null, frameOf("step_start"), 0);
    phase = advancePhase(phase, frameOf("message_start", { role: "assistant" }), 1000);
    phase = advancePhase(phase, frameOf("text_delta", { delta: "答" }), 1800);
    phase = advancePhase(phase, frameOf("message_end", { role: "assistant" }), 3000);
    phase = advancePhase(
      phase,
      frameOf("tool_start", { toolName: "bash", toolCallId: "t1" }),
      3200,
    );
    phase = advancePhase(phase, frameOf("tool_end", { toolName: "bash", toolCallId: "t1" }), 5200);

    assert.deepEqual(phase?.segments, {
      response: 1200,
      firstToken: 800,
      streaming: 1200,
      tool: 2000,
      userWait: 0,
    });
  });

  it("并行多次调用只报一批：同一个起点的调用逐个入账，一个结束仍留在工具阶段", () => {
    const one = advancePhase(
      null,
      frameOf("tool_start", { toolName: "bash", toolCallId: "t1" }),
      1,
    );
    const two = advancePhase(one, frameOf("tool_start", { toolName: "bash", toolCallId: "t2" }), 2);
    const three = advancePhase(
      two,
      frameOf("tool_start", { toolName: "read", toolCallId: "t3" }),
      3,
    );
    // 同一次调用的重复声明不再入账（归并层对 tool_start 就是幂等的）
    const again = advancePhase(
      three,
      frameOf("tool_start", { toolName: "read", toolCallId: "t3" }),
      3,
    );
    const ended = advancePhase(
      again,
      frameOf("tool_end", { toolName: "bash", toolCallId: "t1" }),
      4,
    );

    assert.deepEqual(one, phaseOf("tool", 1, { tools: [{ id: "t1", name: "bash" }] }));
    assert.equal(two?.tools.length, 2);
    assert.equal(again, three);
    // 同名并行按 id 配对：还剩一个 bash 在跑，一起算掉会让文案提前报「等待模型响应」
    assert.deepEqual(ended?.tools, [
      { id: "t2", name: "bash" },
      { id: "t3", name: "read" },
    ]);
    assert.equal(ended?.kind, "tool");
  });

  it("工具全部结束才回到等待，下一个工具起新的起点", () => {
    const running = advancePhase(
      null,
      frameOf("tool_start", { toolName: "bash", toolCallId: "t1" }),
      1,
    );
    const waited = advancePhase(
      running,
      frameOf("tool_end", { toolName: "bash", toolCallId: "t1" }),
      2,
    );
    const next = advancePhase(
      waited,
      frameOf("tool_start", { toolName: "read", toolCallId: "t2" }),
      3,
    );

    assert.equal(waited?.kind, "waitingResponse");
    assert.equal(waited?.startedAt, 2);
    assert.equal(next?.kind, "tool");
    assert.equal(next?.startedAt, 3, "新工具起新的起点，读数不会接着报上一批的时间");
    assert.deepEqual(next?.tools, [{ id: "t2", name: "read" }]);
  });

  it("没记过的工具调用结束时不改阶段（重连后只收到尾帧）", () => {
    const streaming = phaseOf("streaming", 1);
    assert.equal(
      advancePhase(streaming, frameOf("tool_end", { toolName: "bash", toolCallId: "t9" }), 9),
      streaming,
    );
  });

  it("等用户不换阶段：工具还挂在占位上，只把等待时长单独记账", () => {
    const running = advancePhase(
      null,
      frameOf("tool_start", { toolName: "question", toolCallId: "t1" }),
      100,
    );
    const waiting = advancePhase(
      running,
      frameOf("interaction_request", { kind: "question" }),
      200,
    );

    assert.equal(waiting?.kind, "tool", "工具还在跑，阶段照旧是工具");
    assert.deepEqual(waiting?.waiting, { kind: "question", since: 200 });
    // 并发挂起：后到的那条不重开计时
    assert.equal(
      advancePhase(waiting, frameOf("interaction_request", { kind: "permission" }), 300),
      waiting,
    );

    const resolved = advancePhase(
      waiting,
      frameOf("interaction_resolved", { requestId: "r1" }),
      1200,
    );
    assert.equal(resolved?.waiting, null);
    assert.equal(resolved?.segments.userWait, 1000);
    // 没挂起时的结算（迟到的回答）什么都不动
    assert.equal(
      advancePhase(resolved, frameOf("interaction_resolved", { requestId: "r1" }), 1300),
      resolved,
    );
  });

  it("本轮落定清空阶段，其余帧一律保持原阶段", () => {
    const phase = phaseOf("tool", 1, { tools: [{ id: "t1", name: "bash" }] });

    assert.equal(advancePhase(phase, frameOf("agent_settled"), 5), null);
    assert.equal(advancePhase(null, frameOf("interaction_request", { kind: "question" }), 5), null);
    for (const type of ["subagent_start", "service_update", "queue_update", "tool_update"]) {
      assert.equal(advancePhase(phase, frameOf(type), 5), phase, type);
    }
  });
});

describe("stepBreakdown", () => {
  it("列出已走过的分段，当前这一段算到此刻", () => {
    let phase: StreamPhase | null = advancePhase(null, frameOf("step_start"), 0);
    phase = advancePhase(phase, frameOf("message_start", { role: "assistant" }), 1000);
    assert.ok(phase);

    const early = stepBreakdown(phase, 1500);

    assert.deepEqual(early.rows, [
      { key: "response", ms: 1000 },
      { key: "firstToken", ms: 500 },
    ]);
    assert.equal(early.totalMs, 1500);
    assert.equal(early.userWaitMs, 0);
  });

  it("等用户与工具段重叠：单独给，不并进本步总数", () => {
    let phase: StreamPhase | null = advancePhase(null, frameOf("step_start"), 0);
    phase = advancePhase(phase, frameOf("message_start", { role: "assistant" }), 1000);
    phase = advancePhase(
      phase,
      frameOf("tool_start", { toolName: "bash", toolCallId: "t1" }),
      2000,
    );
    phase = advancePhase(phase, frameOf("interaction_request", { kind: "permission" }), 2100);
    assert.ok(phase);

    const waiting = stepBreakdown(phase, 3100);

    assert.deepEqual(
      waiting.rows.map((row) => row.key),
      ["response", "firstToken", "tool"],
    );
    assert.equal(waiting.rows[0]?.ms, 1000);
    assert.equal(waiting.rows[1]?.ms, 1000);
    assert.equal(waiting.rows[2]?.ms, 1100);
    assert.equal(waiting.totalMs, 3100, "四段互不重叠，加起来就是本步已走的时间");
    assert.equal(waiting.userWaitMs, 1000, "挂起中的这一段也要算到此刻");
  });
});
