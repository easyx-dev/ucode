/**
 * 会话流引擎的服务清单归并单测：`service_update` 是全量帧收到即替换，
 * 快照 hydrate 与 `refreshServices` 都以权威结果为准。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BackgroundService, MessageListResponse, ServerEventPayload } from "@ucode/contracts";
import type { Apis } from "../../../apis";
import type { EventStream } from "../../../events";
import type { PromptPayload } from "../../../types";
import { applyFrame, createEngine, optimisticBlocks } from "../engine";
import { createMessagesStore } from "../index";

const serviceOf = (port: number): BackgroundService => ({
  id: String(port),
  command: `serve --port ${port}`,
  cwd: "/w",
  port,
  url: `http://127.0.0.1:${port}`,
  startedAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
});

const frameOf = (type: string, data: unknown): ServerEventPayload =>
  ({ type, sessionId: "s1", seq: 1, data }) as ServerEventPayload;

const snapshotOf = (services: BackgroundService[]): MessageListResponse => ({
  sessionId: "s1",
  messages: [],
  persisted: false,
  cwd: "/w",
  running: false,
  subagents: [],
  services,
  seq: 1,
});

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** 假接口与假事件流：只实现 store 真正用到的入口 */
const createHarness = (
  snapshot: MessageListResponse,
  refreshed: BackgroundService[],
): {
  store: ReturnType<typeof createMessagesStore>;
  emit: (frame: ServerEventPayload) => void;
} => {
  const handlers: Array<(frame: ServerEventPayload) => void> = [];
  const events = {
    onEvent: (handler: (frame: ServerEventPayload) => void) => {
      handlers.push(handler);
    },
    onConnected: () => {},
  } as unknown as EventStream;
  const apis = {
    messages: {
      list: async () => snapshot,
      services: async () => ({ sessionId: snapshot.sessionId, services: refreshed }),
    },
  } as unknown as Apis;

  return {
    store: createMessagesStore({ apis, events }),
    emit: (frame) => {
      for (const handler of handlers) handler(frame);
    },
  };
};

describe("会话流 · 后台服务清单", () => {
  it("service_update 是全量帧：收到即整份替换", () => {
    const engine = createEngine();

    applyFrame(engine, frameOf("service_update", [serviceOf(5173)]));
    assert.deepEqual(engine.store.getState().services, [serviceOf(5173)]);

    applyFrame(engine, frameOf("service_update", []));
    assert.deepEqual(engine.store.getState().services, []);
  });

  it("载荷不可信：非数组一律当作没有服务", () => {
    const engine = createEngine();
    applyFrame(engine, frameOf("service_update", [serviceOf(5173)]));
    applyFrame(engine, frameOf("service_update", { port: 5173 }));

    assert.deepEqual(engine.store.getState().services, []);
  });

  it("快照带的服务清单在 hydrate 后生效", async () => {
    const snapshot = serviceOf(3000);
    const { store } = createHarness(snapshotOf([snapshot]), []);

    store.activate("s1");
    await tick();

    assert.deepEqual(store.get("s1").getState().services, [snapshot]);
  });

  it("事件帧能覆盖快照带来的清单", async () => {
    const { store, emit } = createHarness(snapshotOf([serviceOf(3000)]), []);
    store.activate("s1");
    await tick();

    emit(frameOf("service_update", [serviceOf(4000)]));

    assert.deepEqual(
      store
        .get("s1")
        .getState()
        .services.map((service) => service.port),
      [4000],
    );
  });

  it("快照缺服务清单（旧服务 / 异常响应）时按空数组处理，不带到界面上炸", async () => {
    const incomplete = { ...snapshotOf([]) } as Partial<MessageListResponse>;
    delete incomplete.services;
    const { store } = createHarness(incomplete as MessageListResponse, []);

    store.activate("s1");
    await tick();

    assert.deepEqual(store.get("s1").getState().services, []);
    assert.equal(store.get("s1").getState().error, null);
  });

  it("refreshServices 用接口结果覆盖本地清单", async () => {
    const { store } = createHarness(snapshotOf([serviceOf(3000)]), [serviceOf(4000)]);
    store.activate("s1");
    await tick();

    await store.refreshServices("s1");

    assert.deepEqual(
      store
        .get("s1")
        .getState()
        .services.map((service) => service.port),
      [4000],
    );
  });
});

/** 生成阶段：服务端的起点帧要让界面在非本端发起的轮次上也能起表并亮起生成态 */
describe("会话流 · 生成阶段", () => {
  it("step_start 点亮生成态并从服务端起表", async () => {
    const { store, emit } = createHarness(snapshotOf([]), []);
    store.activate("s1");
    await tick();

    assert.equal(store.get("s1").getState().running, false);
    assert.equal(store.get("s1").getState().phase, null);

    emit(frameOf("step_start", {}));

    const state = store.get("s1").getState();
    assert.equal(state.running, true);
    assert.equal(state.pending, false);
    assert.equal(state.phase?.kind, "waitingResponse");
    assert.equal(
      typeof (state.phase?.kind === "waitingResponse" ? state.phase.startedAt : null),
      "number",
    );
  });

  it("本轮落定把阶段清空", async () => {
    const { store, emit } = createHarness(snapshotOf([]), []);
    store.activate("s1");
    await tick();

    emit(frameOf("step_start", {}));
    emit(frameOf("agent_settled", {}));

    const state = store.get("s1").getState();
    assert.equal(state.phase, null);
    assert.equal(state.running, false);
  });
});

/** 乐观区块：命令与技能的参数都是用户写的那段，发送瞬间就该显示出来 */
describe("乐观区块", () => {
  const payloadOf = (parts: Partial<PromptPayload>): PromptPayload => ({
    text: "",
    contexts: [],
    attachments: [],
    ...parts,
  });

  it("命令的参数与正文合起来显示", () => {
    assert.deepEqual(
      optimisticBlocks(payloadOf({ command: { name: "todo", args: "记一条" }, text: "收尾" })),
      [{ type: "text", text: "记一条\n\n收尾" }],
    );
  });

  it("技能消息同样有正文（此前只有命令参数被拼进去）", () => {
    assert.deepEqual(
      optimisticBlocks(
        payloadOf({
          skills: [
            { name: "pdf", args: "一" },
            { name: "ts", args: "二" },
          ],
        }),
      ),
      [{ type: "text", text: "一\n\n二" }],
    );
  });

  it("什么都没有时不给空块", () => {
    assert.deepEqual(optimisticBlocks(payloadOf({})), []);
  });
});
