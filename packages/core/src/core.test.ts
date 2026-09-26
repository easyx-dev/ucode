import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_CAPABILITIES, PROTOCOL_VERSION, type ServerMessage } from "@ucode/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type Core, createCore } from "./core.ts";
import { type FakeProvider, startFakeProvider } from "./testing/fake-provider.ts";

/**
 * 核心层的端到端测试（spec §7.3 的 CI 验收 1 的进程内版本）。
 *
 * 用**纯协议客户端**：不依赖 sdk 包，直接按协议 C 收发。
 * 模型调用走假供应商（spec §7.4：核心层测试不能让结果依赖真实模型）。
 */

type TestClient = {
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

let core: Core | undefined;
let provider: FakeProvider | undefined;
let dataDir: string | undefined;
let projectDir: string | undefined;

afterEach(async () => {
  await core?.close();
  core = undefined;
  await provider?.close();
  provider = undefined;
  for (const dir of [dataDir, projectDir]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
  dataDir = undefined;
  projectDir = undefined;
});

async function setup(): Promise<{ core: Core; provider: FakeProvider; projectDir: string }> {
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

function connect(
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

async function handshake(client: TestClient, extras: Record<string, unknown> = {}): Promise<void> {
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

async function command(
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

describe("核心层：握手与信任矩阵", () => {
  it("implicit 通路拿到全部能力；版本不兼容被显式拒绝", async () => {
    const { core: target } = await setup();
    const client = connect(target, "implicit");
    await handshake(client);

    const welcome = (await client.waitFor("welcome")) as Extract<
      ServerMessage,
      { type: "welcome" }
    >;
    expect(welcome.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(welcome.trustLevel).toBe("implicit");
    expect(new Set(welcome.grantedCapabilities)).toEqual(new Set(ALL_CAPABILITIES));
    expect(welcome.dataLayerVersion).toBeGreaterThan(0);

    const bad = connect(target, "implicit");
    await bad.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION + 5,
      clientId: "bad",
      clientKind: "test",
      binding: "test",
    });
    const rejected = (await bad.waitFor("rejected")) as Extract<
      ServerMessage,
      { type: "rejected" }
    >;
    expect(rejected.code).toBe("version_unsupported");
    expect(rejected.coreProtocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("未认证通路：只读 + 对话；工具直调与免批准执行都被挡住", async () => {
    const { core: target, projectDir: dir } = await setup();

    // 会话由本机通路建好（未认证通路按信任矩阵连"新建会话"都不该有）
    const owner = connect(target, "implicit");
    await handshake(owner);
    await owner.waitFor("welcome");
    const created = await command(owner, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await owner.close();

    const client = connect(target, "untrusted");
    await handshake(client);
    const welcome = (await client.waitFor("welcome")) as Extract<
      ServerMessage,
      { type: "welcome" }
    >;
    expect(welcome.trustLevel).toBe("untrusted");
    expect(new Set(welcome.grantedCapabilities)).toEqual(new Set(["sessions.read", "prompt.run"]));

    // 声明了能力但没被授予：拒绝理由是"信任不足"，不是"承载不了"（可诊断性）
    const deniedCreate = await command(client, "session.create", { args: { cwd: dir } });
    expect(deniedCreate.success).toBe(false);
    expect(deniedCreate.error?.code).toBe("unsupported_capability");
    expect(deniedCreate.error?.details).toMatchObject({
      needed: "sessions.write",
      trustLevel: "untrusted",
    });

    // 只读命令可用
    const attached = await command(client, "session.attach", { sessionId });
    expect(attached.success).toBe(true);

    // 工具直调：未认证通路必须被裁掉
    const bash = await command(client, "bash", { sessionId, args: { command: "echo hi" } });
    expect(bash.success).toBe(false);
    expect(bash.error?.code).toBe("unsupported_capability");

    // 自主级别门槛：这条会话是"完全访问"（免批准执行），未认证通路不得驱动它
    const prompt = await command(client, "prompt", { sessionId, args: { text: "你好" } });
    expect(prompt.success).toBe(false);
    expect(prompt.error?.code).toBe("autonomy_denied");
  });
});

describe("核心层：一轮完整对话（M2 验收）", () => {
  it("握手 → 新建会话 → 对话 → 完整事件流 → 取回历史", async () => {
    const { core: target, provider: fake } = await setup();
    fake.queue([{ text: "第一轮回答。" }]);
    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");

    const created = await command(client, "session.create", { args: { cwd: projectDir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    expect(sessionId).toBeTruthy();

    const attached = await command(client, "session.attach", { sessionId });
    expect(attached.success).toBe(true);

    const prompted = await command(client, "prompt", { sessionId, args: { text: "你好" } });
    expect(prompted.success).toBe(true);

    const settled = await client.waitFor("agent_settled", undefined, 15_000);
    expect(settled.type).toBe("agent_settled");

    // 事件面：流式增量（非权威）+ 落盘记录（权威）
    const deltas = client.messages.filter((message) => message.type === "message_delta");
    expect(deltas.length, "应收到流式增量").toBeGreaterThan(0);
    const appended = client.messages.filter(
      (message): message is Extract<ServerMessage, { type: "entry_appended" }> =>
        message.type === "entry_appended",
    );
    expect(appended.length, "应收到落盘记录").toBeGreaterThan(0);
    expect(
      appended.every((message) => message.seq > 0),
      "记录必须带游标（行序号）",
    ).toBe(true);
    expect(client.messages.some((message) => message.type === "turn_end")).toBe(true);

    // 历史：从数据层取回（权威在磁盘，不在内存）
    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (
      history.data as {
        records: { seq: number; entry: { type: string; message?: { role?: string } } }[];
      }
    ).records;
    const roles = records
      .filter((record) => record.entry.type === "message")
      .map((record) => record.entry.message?.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    const cursor = (history.data as { cursor: number }).cursor;
    expect(cursor).toBeGreaterThanOrEqual(records.length);

    // 会话文件本身：pi 兼容的 JSONL（header 在第一行）
    const state = await command(client, "session.get_state", { sessionId });
    const sessionFile = (await target.store.listSessions()).find(
      (session) => session.id === sessionId,
    )?.file;
    expect(sessionFile).toBeTruthy();
    const content = await readFile(sessionFile as string, "utf8");
    const lines = content.trimEnd().split("\n");
    const header = JSON.parse(lines[0] as string) as { type: string; version: number; id: string };
    expect(header.type).toBe("session");
    expect(header.version).toBe(3);
    expect(header.id).toBe(sessionId);
    expect(lines.length).toBe(cursor + 1);
    expect((state.data as { state: { status: string } }).state.status).toBe("idle");
  });
});

describe("核心层：交互面（批准）与降级", () => {
  it("改动类工具触发批准弹窗：批准后执行，并广播给多个 attachment、首个应答生效", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([
      {
        text: "我来写个文件。",
        toolCalls: [{ name: "write", args: { path: join(dir, "hello.txt"), content: "hi" } }],
      },
      { text: "写好了。" },
    ]);
    const primary = connect(target, "implicit");
    await handshake(primary);
    await primary.waitFor("welcome");
    const created = await command(primary, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(primary, "session.attach", { sessionId });

    // 第二个壳子挂载同一会话
    const secondary = connect(target, "local");
    await handshake(secondary);
    await secondary.waitFor("welcome");
    await command(secondary, "session.attach", { sessionId });

    await command(primary, "prompt", { sessionId, args: { text: "帮我写个文件" } });

    // 两个 attachment 都应收到同一条 ui.request（广播，不是择一）
    const request = (await primary.waitFor("ui.request", undefined, 15_000)) as Extract<
      ServerMessage,
      { type: "ui.request" }
    >;
    expect(request.method).toBe("select");
    const mirrored = (await secondary.waitFor(
      "ui.request",
      (message) => message.id === request.id,
      5_000,
    )) as Extract<ServerMessage, { type: "ui.request" }>;
    expect(mirrored.id).toBe(request.id);

    // 第二个应答（晚到的）必须被忽略；第一个生效（select 的"允许一次"）
    await secondary.send({
      type: "ui.response",
      id: request.id,
      value: "允许一次",
      responderId: secondary.id,
    });
    await primary.send({
      type: "ui.response",
      id: request.id,
      value: "拒绝",
      responderId: primary.id,
    });

    await primary.waitFor("agent_settled", undefined, 15_000);
    await expect(readFile(join(dir, "hello.txt"), "utf8")).resolves.toBe("hi");
    // 首个应答生效 → 另一个 attachment 收到同步关闭
    const cancel = (await primary.waitFor(
      "ui.cancel",
      (message) => message.id === request.id,
    )) as Extract<ServerMessage, { type: "ui.cancel" }>;
    expect(cancel.reason).toBe("answered");
  });

  it("没有可承载交互的通路：请求不发出，直接降级（不放行）", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([
      {
        text: "尝试写文件。",
        toolCalls: [{ name: "write", args: { path: join(dir, "blocked.txt"), content: "x" } }],
      },
      { text: "被拦下了。" },
    ]);
    // 未认证通路不能新建会话（信任矩阵只给它只读 + 对话），所以先由本机通路建好再断开；
    // 于是这个会话上只剩一个"不具批准权"的 attachment —— 没有任何 responder。
    const owner = connect(target, "implicit");
    await handshake(owner);
    await owner.waitFor("welcome");
    const created = await command(owner, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await owner.close();

    const client = connect(target, "untrusted");
    await handshake(client);
    await client.waitFor("welcome");
    const attached = await command(client, "session.attach", { sessionId });
    expect(attached.success).toBe(true);

    await command(client, "prompt", { sessionId, args: { text: "写个文件" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    expect(
      client.messages.some((message) => message.type === "ui.request"),
      "不应发出无法承载的交互请求",
    ).toBe(false);
    await expect(readFile(join(dir, "blocked.txt"), "utf8")).rejects.toThrow();
    // 降级被记在案（会话里有审计记录）
    const entries = await target.store.openSession(sessionId);
    const all = await entries?.entries();
    expect(
      all?.some((entry) => entry.type === "custom" && entry.customType === "tool.decision"),
    ).toBe(true);
  });
});

describe("核心层：断线续传与跟读", () => {
  it("带游标重连：只补齐缺口，且不重复索要已有记录", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "回答一。" }, { text: "回答二。" }]);
    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "第一句" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const cursor = (history.data as { cursor: number }).cursor;
    expect(cursor).toBeGreaterThan(0);

    // 新连接带游标重连：应从 cursor 之后补齐（此时没有新记录 → 只拿到 welcome + resumeAck）
    const resumed = connect(target, "implicit");
    await handshake(resumed, { resume: { sessionId, fromSeq: cursor } });
    const welcome = (await resumed.waitFor("welcome")) as Extract<
      ServerMessage,
      { type: "welcome" }
    >;
    expect(welcome.resumeAck?.valid).toBe(true);
    expect(welcome.resumeAck?.cursor).toBe(cursor);
    const replayed = resumed.messages.filter((message) => message.type === "entry_appended");
    expect(replayed.length).toBe(0);

    // 续跑第二轮：新记录以游标继续递增
    await command(resumed, "prompt", { sessionId, args: { text: "第二句" } });
    await resumed.waitFor("agent_settled", undefined, 15_000);
    const newRecords = resumed.messages.filter(
      (message): message is Extract<ServerMessage, { type: "entry_appended" }> =>
        message.type === "entry_appended",
    );
    expect(newRecords.length).toBeGreaterThan(0);
    expect(Math.min(...newRecords.map((message) => message.seq))).toBeGreaterThan(cursor);
  });
});

describe("核心层：命令面细节", () => {
  it("工作区查询通道：文件树与 Git 变更（工作区在核心层这台机器上）", async () => {
    const { core: target, projectDir: dir } = await setup();
    await writeFile(join(dir, "note.md"), "# 笔记\n", "utf8");
    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await client.send({ type: "channel.open", channelId: "ch1", channel: "workspace" });
    const opened = (await client.waitFor("channel.opened")) as Extract<
      ServerMessage,
      { type: "channel.opened" }
    >;
    expect(opened.channel).toBe("workspace");

    await client.send({
      type: "channel.request",
      id: "r1",
      channelId: "ch1",
      method: "tree",
      params: {},
    });
    const tree = (await client.waitFor(
      "channel.response",
      (message) => message.id === "r1",
    )) as Extract<ServerMessage, { type: "channel.response" }>;
    const entries = (tree.data as { entries: { path: string; kind: string }[] }).entries;
    expect(entries.some((entry) => entry.path === "note.md" && entry.kind === "file")).toBe(true);

    // 越界读取必须被拒（工作区查询不得读出工作区之外）
    await client.send({
      type: "channel.request",
      id: "r2",
      channelId: "ch1",
      method: "read",
      params: { path: "../../etc/passwd" },
    });
    const denied = (await client.waitFor(
      "channel.response",
      (message) => message.id === "r2",
    )) as Extract<ServerMessage, { type: "channel.response" }>;
    expect(denied.success).toBe(false);
    expect(denied.error).toContain("越界");
  });

  it("解析失败与未知命令：都给可诊断错误（解析失败没有 id）", async () => {
    const { core: target } = await setup();
    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");

    const unknown = await command(client, "does.not.exist");
    expect(unknown.success).toBe(false);
    expect(unknown.error?.code).toBe("unknown_command");

    const badArgs = await command(client, "prompt", { args: {} });
    expect(badArgs.success).toBe(false);
    expect(badArgs.error?.code).toBe("invalid_args");

    // 信封破损（缺 id）：无法得知 id，因此回一条 command="parse" 且 id 为 null 的错误
    await client.send({ type: "command", command: "prompt", args: { text: "hi" } });
    const parseFailure = (await client.waitFor(
      "response",
      (message) => message.command === "parse",
    )) as Extract<ServerMessage, { type: "response" }>;
    expect(parseFailure.success).toBe(false);
    expect(parseFailure.id).toBeNull();
    expect(parseFailure.error?.code).toBe("parse_error");

    // 完全不是协议消息：也给 parse 错误
    await client.send({ type: "nonsense" });
    await client.send(42);
    const count = client.messages.filter(
      (message) => message.type === "response" && message.command === "parse",
    ).length;
    expect(count).toBe(3);
  });
});
