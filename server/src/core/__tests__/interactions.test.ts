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

  it("超时按拒绝结算", async () => {
    const bus = new SessionEventBus();
    const broker = new InteractionBroker(bus, 10);
    const pending = broker.requestPermission("s1", { tool: "edit", subject: "a.ts", scope: "*" });
    assert.equal(await pending, "deny");
  });
});
