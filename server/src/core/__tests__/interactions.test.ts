/** 交互中转单测：请求下发、回答结算、中断 / 会话清理 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServerEvent } from "@ucode/contracts";

import { SessionEventBus } from "../event-bus";
import { InteractionBroker } from "../interactions";

const framesOf = (bus: SessionEventBus): Array<{ type: string; data: unknown }> => {
  const frames: Array<{ type: string; data: unknown }> = [];
  bus.subscribe((frame: ServerEvent) => {
    if ("data" in frame) frames.push({ type: frame.type, data: frame.data });
  });
  return frames;
};

const requestIdOf = (frame: { data: unknown }): string =>
  (frame.data as { requestId: string }).requestId;

describe("InteractionBroker", () => {
  it("结算留痕：答复、来源子会话结束各记一次，带会话与请求 id", async () => {
    const bus = new SessionEventBus();
    const frames = framesOf(bus);
    const records: Array<{ sessionId: string; outcome: string; requestId: string }> = [];
    const broker = new InteractionBroker(bus, ({ sessionId, request, outcome }) =>
      records.push({ sessionId, outcome, requestId: request.requestId }),
    );

    const answered = broker.requestQuestion("s1", [
      {
        header: "确认",
        question: "要不要继续？",
        options: [{ label: "要", description: "继续跑" }],
      },
    ]);
    const question = frames.find((frame) => frame.type === "interaction_request");
    assert.ok(question, "应下发 interaction_request");
    const questionId = requestIdOf(question);
    broker.respond({ requestId: questionId, kind: "question", answers: [["要"]] });
    await answered;

    // 子会话结束时的结算：来源是子会话，请求挂在父会话下
    const orphan = broker.requestPermission(
      "s1",
      { tool: "bash", subject: "ls", scope: "命令" },
      { sourceSessionId: "sub-1", sourceDescription: "侦察" },
    );
    broker.forgetSource("s1", "sub-1");
    await orphan;

    assert.deepEqual(
      records.map((item) => item.outcome),
      ["resolved", "dismissed"],
    );
    assert.equal(records[0]?.sessionId, "s1");
    assert.equal(records[0]?.requestId, questionId);
  });

  it("中止与清理分别留 aborted / dismissed", async () => {
    const bus = new SessionEventBus();
    const outcomes: string[] = [];
    const broker = new InteractionBroker(bus, ({ outcome }) => outcomes.push(outcome));

    const controller = new AbortController();
    const pending = broker.requestPermission("s1", {
      tool: "bash",
      subject: "ls",
      scope: "命令",
      signal: controller.signal,
    });
    controller.abort();
    await pending;

    const forgotten = broker.requestPermission("s1", {
      tool: "write",
      subject: "a.ts",
      scope: "文件",
    });
    broker.forget("s1");
    await forgotten;

    assert.deepEqual(outcomes, ["aborted", "dismissed"]);
  });

  it("请求时下发事件，回答后结算并广播 resolved", async () => {
    const bus = new SessionEventBus();
    const frames = framesOf(bus);
    const broker = new InteractionBroker(bus);

    const pending = broker.requestPermission("s1", {
      tool: "bash",
      subject: "rm -rf /",
      scope: "*",
    });
    const request = frames.find((frame) => frame.type === "interaction_request");
    assert.ok(request, "应下发 interaction_request");
    const requestId = requestIdOf(request);

    assert.deepEqual(
      broker.list("s1").map((item) => item.requestId),
      [requestId],
    );

    const response = broker.respond({ requestId, kind: "permission", decision: "allow_once" });
    assert.equal(response.resolved, true);
    assert.deepEqual(await pending, { decision: "allow_once", byUser: true });
    assert.ok(frames.some((frame) => frame.type === "interaction_resolved"));
  });

  it("重复回答返回 resolved=false", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus);
    const pending = broker.requestPermission("s1", {
      tool: "read",
      subject: ".env",
      scope: "*.env",
    });
    const requestId = broker.list("s1")[0]?.requestId ?? "";

    assert.equal(
      broker.respond({ requestId, kind: "permission", decision: "deny" }).resolved,
      true,
    );
    assert.equal(
      broker.respond({ requestId, kind: "permission", decision: "deny" }).resolved,
      false,
    );
    assert.deepEqual(await pending, { decision: "deny", byUser: true });
  });

  it("会话清理时挂起请求按拒绝结算，且标明不是用户答复", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus);
    const pending = broker.requestPermission("s1", { tool: "edit", subject: "a.ts", scope: "*" });
    broker.forget("s1");
    assert.deepEqual(await pending, { decision: "deny", byUser: false });
    assert.equal(broker.list("s1").length, 0);
  });

  it("forgetSource 只结算指定来源子会话的请求，父会话自身请求保留", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus);
    const child = broker.requestPermission(
      "p1",
      { tool: "read", subject: "/etc/hosts", scope: "/etc/**" },
      { sourceSessionId: "sub-1", sourceDescription: "侦察影响面" },
    );
    const parent = broker.requestPermission("p1", { tool: "bash", subject: "ls", scope: "*" });

    broker.forgetSource("p1", "sub-1");
    assert.deepEqual(await child, { decision: "deny", byUser: false });
    assert.equal(broker.list("p1").length, 1, "父会话自身的请求不应被清掉");

    broker.forget("p1");
    assert.deepEqual(await parent, { decision: "deny", byUser: false });
  });

  it("本轮中断时挂起的审批按拒绝结算", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus);
    const controller = new AbortController();
    const pending = broker.requestPermission("s1", {
      tool: "edit",
      subject: "a.ts",
      scope: "*",
      signal: controller.signal,
    });

    controller.abort();
    assert.deepEqual(await pending, { decision: "deny", byUser: false });
    assert.equal(broker.list("s1").length, 0, "中断后不应留下待答请求");
  });

  it("信号已中断时不挂起请求", async () => {
    const bus = new SessionEventBus();
    const frames = framesOf(bus);
    const broker = new InteractionBroker(bus);
    const controller = new AbortController();
    controller.abort();

    const outcome = await broker.requestPermission("s1", {
      tool: "edit",
      subject: "a.ts",
      scope: "*",
      signal: controller.signal,
    });
    assert.deepEqual(outcome, { decision: "deny", byUser: false });
    assert.equal(broker.list("s1").length, 0);
    assert.equal(frames.length, 0, "不应下发已经失效的请求");
  });
});

describe("InteractionBroker question 通道", () => {
  const questions = [
    {
      header: "发布分支",
      question: "从哪个分支发布？",
      options: [
        { label: "main", description: "稳定分支" },
        { label: "staging", description: "预发分支" },
      ],
    },
  ];

  it("提问下发事件，回答后结算并广播 resolved", async () => {
    const bus = new SessionEventBus();
    const frames = framesOf(bus);
    const broker = new InteractionBroker(bus);

    const pending = broker.requestQuestion("s1", questions);
    const request = frames.find((frame) => frame.type === "interaction_request");
    assert.ok(request, "应下发 interaction_request");
    const requestId = requestIdOf(request);

    const listed = broker.list("s1")[0];
    assert.equal(listed?.kind, "question");

    const response = broker.respond({
      requestId,
      kind: "question",
      answers: [["staging"]],
    });
    assert.equal(response.resolved, true);
    assert.deepEqual(await pending, { kind: "answered", answers: [["staging"]] });
    assert.ok(frames.some((frame) => frame.type === "interaction_resolved"));
  });

  it("kind 不一致时不结算，原请求保留", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus);
    const pending = broker.requestQuestion("s1", questions);
    const requestId = broker.list("s1")[0]?.requestId ?? "";

    assert.equal(
      broker.respond({ requestId, kind: "permission", decision: "deny" }).resolved,
      false,
    );
    assert.equal(broker.list("s1").length, 1);

    broker.respond({ requestId, kind: "question", answers: [["main"]] });
    assert.deepEqual(await pending, { kind: "answered", answers: [["main"]] });
  });

  it("中断信号取消挂起请求", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus);
    const controller = new AbortController();
    const pending = broker.requestQuestion("s1", questions, controller.signal);

    controller.abort();
    assert.deepEqual(await pending, { kind: "cancelled" });
    assert.equal(broker.list("s1").length, 0);
  });

  it("会话清理时挂起提问按取消结算", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus);
    const pending = broker.requestQuestion("s1", questions);
    broker.forget("s1");
    assert.deepEqual(await pending, { kind: "cancelled" });
  });
});
