/** 标题服务的触发边界：什么时候发起、写回什么、失败后补一次的时机 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ServerEvent } from "@ucode/contracts";

import type { SessionEventBus } from "../../../core/event-bus";
import type { SessionRecord, SessionRepository } from "../../../db/session-repository";
import { TitleService } from "../index";

type SessionMessage = AgentSession["messages"][number];

const user = (text: string): SessionMessage => ({ role: "user", content: text }) as SessionMessage;
const assistant = (text: string): SessionMessage =>
  ({ role: "assistant", content: [{ type: "text", text }] }) as SessionMessage;
const answer = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });

/** 生成是「不 await 调用方」的后台动作，断言前让微任务与定时器跑一轮 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const recordOf = (overrides: Partial<SessionRecord> = {}): SessionRecord =>
  ({
    id: "s1",
    name: null,
    deletedAt: null,
    parentSessionId: null,
    ...overrides,
  }) as SessionRecord;

/** 最小可用的会话替身：只覆盖标题服务真正读到的东西 */
const makeSession = (
  messages: SessionMessage[],
  completeSimple: () => Promise<unknown>,
  appended: string[] = [],
): AgentSession =>
  ({
    messages,
    model: { id: "test-model" },
    modelRuntime: { completeSimple },
    sessionManager: { appendSessionInfo: (title: string) => appended.push(title) },
  }) as unknown as AgentSession;

const setup = (options: { record?: SessionRecord; live: AgentSession }) => {
  let record = options.record ?? recordOf();
  const writes: Array<{ id: string; override: unknown }> = [];
  const summaries: string[] = [];
  const subscribers: Array<(frame: ServerEvent) => void> = [];
  const service = new TitleService({
    sessions: {
      find: () => record,
      set: (id: string, override: Record<string, unknown>) => {
        writes.push({ id, override });
        // 写库后 `find` 就该读到新名字：后续判断（用户命名优先、是否已生成）都依赖它
        record = { ...record, ...override } as SessionRecord;
      },
    } as unknown as SessionRepository,
    events: {
      subscribe: (subscriber: (frame: ServerEvent) => void) => {
        subscribers.push(subscriber);
        return () => {};
      },
    } as unknown as SessionEventBus,
    liveOf: () => options.live,
    emitSummary: (sessionId) => summaries.push(sessionId),
  });
  const settle = (sessionId: string): void => {
    for (const subscriber of subscribers) {
      subscriber({ type: "agent_settled", sessionId, seq: 1, data: {} } as ServerEvent);
    }
  };
  return { service, writes, summaries, settle };
};

describe("TitleService.generateForPrompt", () => {
  it("首轮投递时并行生成并写回", async () => {
    const appended: string[] = [];
    const session = makeSession([], () => Promise.resolve(answer("修复登录超时")), appended);
    const { service, writes, summaries } = setup({ live: session });

    service.generateForPrompt("s1", session, "登录超时了");
    await tick();

    assert.deepEqual(appended, ["修复登录超时"]);
    assert.deepEqual(writes, [{ id: "s1", override: { name: "修复登录超时" } }]);
    assert.deepEqual(summaries, ["s1"]);
  });

  it("会话里已有用户消息时不再发起", async () => {
    let calls = 0;
    const session = makeSession([user("一"), assistant("回复一")], () => {
      calls += 1;
      return Promise.resolve(answer("标题"));
    });
    const { service } = setup({ live: session });

    service.generateForPrompt("s1", session, "二");
    await tick();

    assert.equal(calls, 0);
  });

  it("子会话、用户已命名或已删除的会话都不发起", async () => {
    let calls = 0;
    const complete = (): Promise<unknown> => {
      calls += 1;
      return Promise.resolve(answer("标题"));
    };

    const child = makeSession([], complete);
    setup({
      record: recordOf({ parentSessionId: "parent" }),
      live: child,
    }).service.generateForPrompt("s1", child, "子任务");
    const named = makeSession([], complete);
    setup({ record: recordOf({ name: "用户起的名字" }), live: named }).service.generateForPrompt(
      "s1",
      named,
      "提问",
    );
    const removed = makeSession([], complete);
    setup({
      record: recordOf({ deletedAt: "2026-01-01T00:00:00.000Z" }),
      live: removed,
    }).service.generateForPrompt("s1", removed, "提问");
    await tick();

    assert.equal(calls, 0);
  });
});

describe("TitleService 落定兜底", () => {
  it("并行生成失败后用完整交流补一次，之后不再重复", async () => {
    const appended: string[] = [];
    // 投递时首轮还没有消息，这一轮跑完才有交流可概括
    const messages: SessionMessage[] = [];
    let attempt = 0;
    const session = makeSession(
      messages,
      () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error("限流"))
          : Promise.resolve(answer("修复登录超时"));
      },
      appended,
    );
    const { service, settle } = setup({ live: session });

    service.generateForPrompt("s1", session, "登录超时了");
    await tick();
    assert.equal(attempt, 1);
    assert.deepEqual(appended, []);

    messages.push(user("登录超时了"), assistant("我看下"));
    settle("s1");
    await tick();
    assert.equal(attempt, 2);
    assert.deepEqual(appended, ["修复登录超时"]);

    settle("s1");
    await tick();
    assert.equal(attempt, 2);
  });

  it("并行成功后的落定不再补一次", async () => {
    let attempt = 0;
    const session = makeSession([], () => {
      attempt += 1;
      return Promise.resolve(answer("修复登录超时"));
    });
    const { service, settle } = setup({ live: session });

    service.generateForPrompt("s1", session, "登录超时了");
    await tick();
    settle("s1");
    settle("s1");
    await tick();

    assert.equal(attempt, 1);
  });
});
