import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_CAPABILITIES, PROTOCOL_VERSION, type ServerMessage } from "@ucode/protocol";
import { type Core, createCore } from "../core.ts";
import { type FakeProvider, startFakeProvider } from "./fake-provider.ts";

/**
 * 核心层端到端测试的共享 harness：假供应商与数据层搭建、纯协议客户端、
 * 握手/命令/通道等待等辅助，供各主题的 core-*.test.ts 复用。
 */

export type TestClient = {
  id: string;
  messages: ServerMessage[];
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
  lastOfType<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined;
  waitFor<T extends ServerMessage["type"]>(
    type: T,
    predicate?: (message: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs?: number,
  ): Promise<Extract<ServerMessage, { type: T }>>;
};

/** 会话记录的最小形状（测试里读 custom 目标状态用）。 */
export type EntryRecord = {
  seq: number;
  entry: {
    id?: string;
    type?: string;
    customType?: string;
    data?: unknown;
    targetId?: string;
    message?: { role?: string };
  };
};

export let core: Core | undefined;
export let provider: FakeProvider | undefined;
export let dataDir: string | undefined;
export let projectDir: string | undefined;

/** 关掉 core 与假供应商、清理临时目录，并把模块级状态复位。 */
export async function teardown(): Promise<void> {
  await core?.close();
  core = undefined;
  await provider?.close();
  provider = undefined;
  for (const dir of [dataDir, projectDir]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
  dataDir = undefined;
  projectDir = undefined;
}

export async function setup(): Promise<{ core: Core; provider: FakeProvider; projectDir: string }> {
  provider = await startFakeProvider();
  dataDir = await mkdtemp(join(tmpdir(), "core-e2e-data-"));
  projectDir = await mkdtemp(join(tmpdir(), "core-e2e-project-"));
  await provider.writeModelsJson(dataDir);
  core = await createCore({
    dataDir,
    cwd: projectDir,
    interactionTimeoutMs: 2_000,
  });
  return { core, provider, projectDir };
}

export function connect(
  target: Core,
  trustLevel: "implicit" | "local" | "untrusted",
  _capabilities = ALL_CAPABILITIES,
): TestClient {
  const messages: ServerMessage[] = [];
  const handle = target.attachConnection({
    binding: "test",
    trustLevel,
    send: (message) => messages.push(message),
  });

  const client: TestClient = {
    id: handle.id,
    messages,
    send: async (message: unknown) => {
      await handle.receive(message);
    },
    close: async () => {
      await handle.close();
    },
    lastOfType: (type) => messages.findLast((message) => message.type === type) as never,
    waitFor: (type, predicate, timeoutMs = 8_000) =>
      new Promise((resolve, reject) => {
        const existing = messages.find(
          (message) =>
            message.type === type &&
            (predicate === undefined || (predicate as (m: unknown) => boolean)(message)),
        );
        if (existing !== undefined) {
          resolve(existing as never);
          return;
        }
        const timer = setTimeout(() => {
          clearInterval(poll);
          reject(
            new Error(
              `等待 ${type} 超时。已收到：${messages.map((message) => message.type).join(", ")}`,
            ),
          );
        }, timeoutMs);
        const poll = setInterval(() => {
          const found = messages.find(
            (message) =>
              message.type === type &&
              (predicate === undefined || (predicate as (m: unknown) => boolean)(message)),
          );
          if (found !== undefined) {
            clearTimeout(timer);
            clearInterval(poll);
            resolve(found as never);
          }
        }, 20);
      }),
  };
  return client;
}

/** 等某条通道应答（channel.response 不属于事件流，`waitFor` 的类型联合里没有）。 */
export async function waitForChannel<T>(client: TestClient, id: string): Promise<T> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const found = client.messages.find(
      (message) =>
        (message as { type?: string; id?: string }).type === "channel.response" &&
        (message as { id?: string }).id === id,
    );
    if (found !== undefined) return found as T;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待通道应答 ${id} 超时`);
}

/** 等第 N 次 agent_settled：多轮会话里事件会累积，`waitFor` 会命中旧的。 */
export async function waitForSettles(
  client: TestClient,
  count: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.messages.filter((message) => message.type === "agent_settled").length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`等待第 ${count} 次 agent_settled 超时`);
}

export async function handshake(
  client: TestClient,
  extras: Record<string, unknown> = {},
): Promise<void> {
  await client.send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    clientId: client.id,
    clientKind: "test",
    binding: "test",
    capabilities: ALL_CAPABILITIES,
    ...extras,
  });
}

export async function command(
  client: TestClient,
  command: string,
  options: { id?: string; sessionId?: string | null; args?: unknown } = {},
): Promise<Extract<ServerMessage, { type: "response" }>> {
  const id = options.id ?? `c${client.messages.length + 1}`;
  await client.send({
    type: "command",
    id,
    command,
    sessionId: options.sessionId ?? null,
    args: options.args ?? {},
  });
  return (await client.waitFor("response", (message) => message.id === id)) as never;
}
