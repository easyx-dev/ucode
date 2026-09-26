import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeProvider, startFakeProvider } from "./fake-provider.ts";

/**
 * 假模型供应商自证：它必须能驱动基座跑完一轮真实对话。
 *
 * 这个测试同时回答一个承重问题：**会话管理用内存态 + 我们自己的 store 落盘**是否可行。
 *
 * 实测结论（决定了核心层的 session-runtime 设计）：
 * - 基座的 `entry_appended` 事件**在正常对话路径上不会触发**（只覆盖扩展追加、上下文编辑等少量路径），
 *   因此"订阅事件再落盘"不可行；
 * - 但内存态管理器本身**会完整记录每一条 entry**（含 id 与 parentId 链）——
 *   于是核心层改为**按差异落盘**：每次事件后比对管理器里的记录，把新增的追加进数据层。
 *   这反而更稳：任何类型的记录都会被覆盖，且"先落盘再广播"由我们自己的顺序保证。
 */

let provider: FakeProvider | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  await provider?.close();
  provider = undefined;
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

async function setup(): Promise<{ provider: FakeProvider; agentDir: string }> {
  provider = await startFakeProvider();
  dataDir = await mkdtemp(join(tmpdir(), "fake-provider-"));
  await provider.writeModelsJson(dataDir);
  return { provider, agentDir: dataDir };
}

describe("假模型供应商", () => {
  it("驱动一轮对话：拿到流式增量、落盘记录与最终文本", async () => {
    const { provider: fake, agentDir } = await setup();
    fake.queue([{ text: "你好，我是假模型。" }]);

    const modelRuntime = await ModelRuntime.create({
      modelsPath: join(agentDir, "models.json"),
      authPath: join(agentDir, "auth.json"),
    });
    const model = modelRuntime.getModel(fake.providerId, fake.modelId);
    expect(model, "假供应商应被基座识别").toBeTruthy();

    const sessionManager = SessionManager.inMemory(process.cwd());
    const { session } = await createAgentSession({
      model,
      modelRuntime,
      sessionManager,
      agentDir,
      cwd: process.cwd(),
      noTools: "all",
    });

    const deltas: string[] = [];
    const eventTypes: string[] = [];
    session.subscribe((event) => {
      eventTypes.push(event.type);
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        deltas.push(event.assistantMessageEvent.delta);
      }
    });

    try {
      await session.prompt("你好");
      expect(deltas.join("")).toContain("假模型");
      expect(session.getLastAssistantText()).toContain("假模型");
      // 内存态管理器完整记录了每一条 entry（核心层据此按差异落盘）
      const entries = sessionManager.getEntries();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((entry) => entry.type === "message")).toBe(true);
      // 基座不应该自己写会话文件（store 才是唯一写者）
      expect(session.sessionFile).toBeUndefined();
      expect(eventTypes).toContain("agent_settled");
      expect(fake.requests.length).toBe(1);
    } finally {
      session.dispose();
    }
  });

  it("内存态管理器可以带着既有记录重建（会话恢复的前提）", async () => {
    const { provider: fake, agentDir } = await setup();
    fake.queue([{ text: "第二轮回复。" }]);

    const seeded: SessionEntry[] = [
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: [{ type: "text", text: "第一轮" }] },
      } as unknown as SessionEntry,
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: new Date().toISOString(),
        message: { role: "assistant", content: [{ type: "text", text: "第一轮回复" }] },
      } as unknown as SessionEntry,
    ];

    const modelRuntime = await ModelRuntime.create({
      modelsPath: join(agentDir, "models.json"),
      authPath: join(agentDir, "auth.json"),
    });
    const model = modelRuntime.getModel(fake.providerId, fake.modelId);
    const sessionManager = SessionManager.inMemory(process.cwd(), undefined, seeded);
    expect(sessionManager.getEntries().length, "既有记录应被载入").toBe(2);

    const { session } = await createAgentSession({
      model,
      modelRuntime,
      sessionManager,
      agentDir,
      cwd: process.cwd(),
      noTools: "all",
    });

    try {
      await session.prompt("第二轮");
      // 新记录的父指针应接在既有记录之后（带父指针的树，不复制历史）
      const entries = sessionManager.getEntries();
      const firstNew = entries.find((entry) => entry.id !== "u1" && entry.id !== "a1");
      expect(firstNew?.parentId).toBe("a1");
    } finally {
      session.dispose();
    }
  });
});
