/** 交互中转单测：请求下发、回答结算、超时与会话清理 */
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
  it("请求时下发事件，回答后结算并广播 resolved", async () => {
    const bus = new SessionEventBus();
    const frames = framesOf(bus);
    const broker = new InteractionBroker(bus, 1000);

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
    assert.equal(await pending, "allow_once");
    assert.ok(frames.some((frame) => frame.type === "interaction_resolved"));
  });

  it("重复回答返回 resolved=false", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 1000);
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
    assert.equal(await pending, "deny");
  });

  it("会话清理时挂起请求按拒绝结算", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 1000);
    const pending = broker.requestPermission("s1", { tool: "edit", subject: "a.ts", scope: "*" });
    broker.forget("s1");
    assert.equal(await pending, "deny");
    assert.equal(broker.list("s1").length, 0);
  });

  it("forgetSource 只结算指定来源子会话的请求，父会话自身请求保留", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 1000);
    const child = broker.requestPermission(
      "p1",
      { tool: "read", subject: "/etc/hosts", scope: "/etc/**" },
      { sourceSessionId: "sub-1", sourceDescription: "侦察影响面" },
    );
    const parent = broker.requestPermission("p1", { tool: "bash", subject: "ls", scope: "*" });

    broker.forgetSource("p1", "sub-1");
    assert.equal(await child, "deny");
    assert.equal(broker.list("p1").length, 1, "父会话自身的请求不应被清掉");

    broker.forget("p1");
    assert.equal(await parent, "deny");
  });

  it("超时按拒绝结算", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 10);
    const pending = broker.requestPermission("s1", { tool: "edit", subject: "a.ts", scope: "*" });
    assert.equal(await pending, "deny");
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
    const broker = new InteractionBroker(bus, 1000, 1000);

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
    const broker = new InteractionBroker(bus, 1000, 1000);
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

  it("超时结算为 timeout", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 1000, 10);
    const pending = broker.requestQuestion("s1", questions);
    assert.deepEqual(await pending, { kind: "timeout" });
  });

  it("中断信号取消挂起请求", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 1000, 1000);
    const controller = new AbortController();
    const pending = broker.requestQuestion("s1", questions, controller.signal);

    controller.abort();
    assert.deepEqual(await pending, { kind: "cancelled" });
    assert.equal(broker.list("s1").length, 0);
  });

  it("会话清理时挂起提问按取消结算", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 1000, 1000);
    const pending = broker.requestQuestion("s1", questions);
    broker.forget("s1");
    assert.deepEqual(await pending, { kind: "cancelled" });
  });
});
