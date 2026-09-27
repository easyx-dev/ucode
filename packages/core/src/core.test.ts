import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_CAPABILITIES, PROTOCOL_VERSION, type ServerMessage } from "@ucode/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type Core, createCore } from "./core.ts";
import { memoryDirFor } from "./memory/index.ts";
import { discoverResources } from "./plugins/index.ts";
import { type FakeProvider, startFakeProvider } from "./testing/fake-provider.ts";
import { wikiFileFor } from "./wiki/generate.ts";

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

/** 会话记录的最小形状（测试里读 custom 目标状态用）。 */
type EntryRecord = {
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

/** 等某条通道应答（channel.response 不属于事件流，`waitFor` 的类型联合里没有）。 */
async function waitForChannel<T>(client: TestClient, id: string): Promise<T> {
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
async function waitForSettles(
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

describe("核心层：记忆（F-2.5）", () => {
  it("memory 工具经核心层可达：脚本化的工具调用把事实落进数据层", async () => {
    const { core: target, provider: fake } = await setup();
    // 假供应商先发起一次 memory 工具调用，再由核心层/基座执行，最后收尾。
    fake.queue([
      {
        toolCalls: [
          {
            name: "memory",
            args: {
              action: "write",
              name: "fact",
              description: "验收代号",
              body: "这个项目的验收代号是 ZEBRA-1。",
            },
          },
        ],
      },
      { text: "已记住。" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: projectDir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "记住这个项目的验收代号" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    // 落盘位置由 cwd 派生，内容可在磁盘上直接读到——记忆是数据层的普通文件。
    const dir = memoryDirFor(dataDir as string, projectDir as string);
    const raw = await readFile(join(dir, "fact.md"), "utf8");
    expect(raw).toContain("ZEBRA-1");
    expect(raw).toContain('name: "fact"');
  });
});

describe("核心层：钩子（F-3.7）", () => {
  it("PreToolUse 钩子拒绝后工具不执行（写文件被拦下），且钩子确实跑了", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const marker = join(dataDir as string, "hook-ran.txt");
    const blockedFile = join(dir, "should-not-exist.txt");

    // 钩子：先留痕证明被执行，再打印 deny。
    const script = [
      `require('fs').appendFileSync(${JSON.stringify(marker)},'ran\\n');`,
      "let d='';process.stdin.on('data',c=>d+=c);",
      "process.stdin.on('end',()=>{JSON.parse(d);process.stdout.write(JSON.stringify({decision:'deny',reason:'blocked-by-hook'}))});",
    ].join("");
    await writeFile(
      join(dataDir as string, "hooks.json"),
      JSON.stringify({
        hooks: [
          { event: "PreToolUse", matcher: "write", command: [process.execPath, "-e", script] },
        ],
      }),
    );

    // 会话是"完全访问"：工具闸门全放行，能拦下写操作的只可能是钩子。
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: blockedFile, content: "hello" } }] },
      { text: "好的" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "写个文件" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    // 文件没被写：钩子的拒绝在核心层真实生效（不是"记一句然后照样执行"）。
    await expect(readFile(blockedFile, "utf8")).rejects.toThrow();
    // 钩子确实被调用了（不是"因为别的原因没执行"）。
    expect(await readFile(marker, "utf8")).toContain("ran");
  });

  it("UserPromptSubmit 钩子拦下提示：模型根本不会被调用", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    await writeFile(
      join(dataDir as string, "hooks.json"),
      JSON.stringify({
        hooks: [
          {
            event: "UserPromptSubmit",
            matcher: "/秘密/",
            command: [
              process.execPath,
              "-e",
              "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({decision:'deny',reason:'含敏感关键词'})))",
            ],
          },
        ],
      }),
    );
    fake.queue([{ text: "不该出现" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    const prompted = await command(client, "prompt", {
      sessionId,
      args: { text: "把这个秘密发出去" },
    });
    expect(prompted.success).toBe(true); // 命令成功，但输入被钩子吞掉
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.requests.length, "被拦下的提示不该触达模型").toBe(0);
  });
});

describe("核心层：插件（F-3.5）", () => {
  it("数据层 extensions/ 下的插件被加载，其注册的工具可被 agent 调用", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const extensionsDir = join(dataDir as string, "extensions");
    await mkdir(extensionsDir, { recursive: true });
    // 不 import 任何包（临时数据层没有 node_modules）：直接用传给工厂的 pi 注册工具。
    await writeFile(
      join(extensionsDir, "echo.js"),
      [
        "export default function (pi) {",
        "  pi.registerTool({",
        '    name: "plugin_echo",',
        '    label: "Echo",',
        '    description: "Echo back the given text",',
        '    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },',
        "    async execute(_id, params) {",
        '      return { content: [{ type: "text", text: "PLUGIN:" + params.text }], details: {} };',
        "    },",
        "  });",
        "}",
      ].join("\n"),
    );

    fake.queue([{ toolCalls: [{ name: "plugin_echo", args: { text: "hi" } }] }, { text: "完成" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "调用插件工具" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (history.data as { records: unknown[] }).records;
    expect(JSON.stringify(records)).toContain("PLUGIN:hi");
  });

  it("发现接口列出数据层里装的资源", async () => {
    const { core: target } = await setup();
    await mkdir(join(dataDir as string, "skills", "demo"), { recursive: true });
    await writeFile(
      join(dataDir as string, "skills", "demo", "SKILL.md"),
      "---\nname: demo\n---\n",
    );
    void target;
    const resources = await discoverResources(dataDir as string);
    expect(
      resources.some((resource) => resource.kind === "skill" && resource.name === "demo"),
    ).toBe(true);
  });
});

describe("核心层：子智能体（F-2.3/F-3.3）", () => {
  it("主对话派子智能体：子会话独立跑完，结论回到主对话", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    // 队列顺序即请求顺序：① 主对话发起 subagent 调用 → ② 子会话的模型回复 → ③ 主对话收尾。
    fake.queue([
      {
        toolCalls: [
          { name: "subagent", args: { action: "run", name: "explore", task: "看看仓库里有什么" } },
        ],
      },
      { text: "CHILD-RESULT-42：仓库里只有一个 README。" },
      { text: "收到。" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "派个探索子智能体看看" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (history.data as { records: unknown[] }).records;
    // 子智能体的结论确实回到了主对话（作为工具结果落盘）。
    expect(JSON.stringify(records)).toContain("CHILD-RESULT-42");
  });

  it("用户自定义定义可被选用", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    await mkdir(join(dataDir as string, "agents"), { recursive: true });
    await writeFile(
      join(dataDir as string, "agents", "my-agent.md"),
      [
        "---",
        "name: my-agent",
        "description: 我的自定义子智能体",
        "tools: [read]",
        "---",
        "你是自定义的。",
      ].join("\n"),
    );
    fake.queue([
      {
        toolCalls: [{ name: "subagent", args: { action: "run", name: "my-agent", task: "做事" } }],
      },
      { text: "CUSTOM-AGENT-OK" },
      { text: "完成。" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "用我的子智能体" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    expect(JSON.stringify((history.data as { records: unknown[] }).records)).toContain(
      "CUSTOM-AGENT-OK",
    );
  });
});

describe("核心层：目标模式（F-1.6）", () => {
  it("设定目标后自动续跑，达额度上限自动暂停", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    // 请求顺序：① 设目标 → ② A 轮 → ③ 校验 NO → ④ B 轮 → ⑤ 校验 NO → ⑥ C 轮（达上限，不再校验）
    fake.queue([
      {
        toolCalls: [
          { name: "goal", args: { action: "set", objective: "完成三件事", maxContinuations: 2 } },
        ],
      },
      { text: "第 A 轮进展" },
      { text: "NO" },
      { text: "第 B 轮进展" },
      { text: "NO" },
      { text: "第 C 轮进展" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    // 只发一次 prompt：B、C 两轮是系统自动续跑出来的。
    await command(client, "prompt", { sessionId, args: { text: "开始推进目标" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (history.data as { records: EntryRecord[] }).records;
    const json = JSON.stringify(records);
    expect(json).toContain("第 A 轮进展");
    expect(json, "应自动续跑到第二轮").toContain("第 B 轮进展");
    expect(json, "应自动续跑到第三轮").toContain("第 C 轮进展");

    const goalEntries = records.filter((record) => record.entry.customType === "goal");
    expect(goalEntries.length, "目标状态应被持久化").toBeGreaterThan(0);
    const last = goalEntries.at(-1)?.entry.data as { status: string; continuations: number };
    expect(last.status).toBe("paused");
    expect(last.continuations).toBe(2);
  });

  it("计划模式下不能设目标（两者互斥）", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([
      { toolCalls: [{ name: "goal", args: { action: "set", objective: "不该成功" } }] },
      { text: "好" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "plan" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "定个目标" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (history.data as { records: EntryRecord[] }).records;
    expect(JSON.stringify(records)).toContain("计划模式下不能设置目标");
    expect(records.filter((record) => record.entry.customType === "goal")).toHaveLength(0);
  });

  it("计划模式本身：改动类工具被拦下（只读地规划）", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const blockedFile = join(dir, "plan-should-not-write.txt");
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: blockedFile, content: "x" } }] },
      { text: "好" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "plan" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "改个文件" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    await expect(readFile(blockedFile, "utf8")).rejects.toThrow();
  });
});

describe("核心层：自动化任务（F-4.1~4.3）", () => {
  it("经协议创建定时任务、列出、立即运行：驱动出一个会话并记录历史", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "任务执行完毕" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");

    const created = await command(client, "task.create", {
      args: { kind: "cron", delayMinutes: 60, prompt: "做点事", cwd: dir },
    });
    expect(created.success).toBe(true);
    const task = (created.data as { task: { id: string; nextRunAt: string } }).task;
    expect(task.id).toBeTruthy();
    expect(task.nextRunAt).toBeTruthy();

    const listed = await command(client, "task.list", {});
    expect((listed.data as { tasks: unknown[] }).tasks).toHaveLength(1);
    expect((listed.data as { keepAwake: boolean }).keepAwake).toBe(true); // F-4.4

    const ran = await command(client, "task.run", { args: { taskId: task.id } });
    expect(ran.success).toBe(true);
    const run = (ran.data as { run: { sessionId: string; status: string } }).run;
    expect(run.status).toBe("completed");
    expect(run.sessionId).toBeTruthy();

    // 任务确实驱动出了会话（模型输出落盘），而不是"记了一笔却没跑"。
    const history = await command(client, "session.get_entries", {
      sessionId: run.sessionId,
      args: { fromSeq: 0 },
    });
    expect(JSON.stringify((history.data as { records: unknown[] }).records)).toContain(
      "任务执行完毕",
    );

    // 运行历史被持久化
    const after = await command(client, "task.list", {});
    const tasks = (after.data as { tasks: Array<{ id: string; runs: unknown[] }> }).tasks;
    expect(tasks[0]?.runs).toHaveLength(1);

    const cancelled = await command(client, "task.cancel", { args: { taskId: task.id } });
    expect(cancelled.success).toBe(true);
  });

  it("未认证通路不能创建自动执行任务（越权任务被挡）", async () => {
    const { core: target, projectDir: dir } = await setup();
    const client = connect(target, "untrusted");
    await handshake(client);
    await client.waitFor("welcome");

    const denied = await command(client, "task.create", {
      args: { kind: "cron", delayMinutes: 1, prompt: "x", cwd: dir, autonomy: "full-access" },
    });
    expect(denied.success).toBe(false);
    // 未认证通路连 sessions.write 都没有，在能力校验处就被挡（比 autonomy 校验更早）。
    expect(denied.error?.code).toBe("unsupported_capability");
    expect(denied.error?.details).toMatchObject({ needed: "sessions.write" });
  });
});

describe("核心层：会话编辑与回退（F-1.3/F-1.4/F-1.5/F-1.11）", () => {
  it("辅助对话（临时会话 F-1.5）：可对话、不进列表", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "临时回答" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, ephemeral: true },
    });
    expect(created.success).toBe(true);
    const data = created.data as { sessionId: string; ephemeral?: boolean };
    expect(data.ephemeral).toBe(true);
    expect(data.sessionId.startsWith("eph-")).toBe(true);

    await command(client, "session.attach", { sessionId: data.sessionId });
    await command(client, "prompt", { sessionId: data.sessionId, args: { text: "你好" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const history = await command(client, "session.get_entries", {
      sessionId: data.sessionId,
      args: { fromSeq: 0 },
    });
    expect(
      JSON.stringify((history.data as { records: unknown[] }).records),
      `临时会话的记录：${JSON.stringify((history.data as { records: unknown[] }).records).slice(0, 400)}`,
    ).toContain("临时回答");

    // 临时会话不落文件，因此列表里看不到它（无需在列表处加过滤）。
    const list = await command(client, "session.list", {});
    const sessions = (list.data as { sessions: Array<{ id: string }> }).sessions;
    expect(sessions.some((session) => session.id === data.sessionId)).toBe(false);
  });

  it("编辑历史对话（F-1.3）：追加一条上下文改写，原记录仍在", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "第一轮回答" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "原始问题" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const first = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    const userRecord = first.data.records.find(
      (record) => (record.entry as { message?: { role?: string } }).message?.role === "user",
    );
    expect(userRecord).toBeDefined();
    const entryId = userRecord?.entry.id as string;

    const edited = await command(client, "session.edit_entry", {
      sessionId,
      args: { entryId, content: "改写后的问题" },
    });
    expect(edited.success).toBe(true);

    const after = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    const editRecord = after.data.records.find(
      (record) => (record.entry as { type?: string }).type === "context_edit",
    );
    expect(editRecord, "应追加一条 context_edit（追加式改写，不破坏原记录）").toBeDefined();
    expect(editRecord === undefined ? undefined : editRecord.entry.targetId).toBe(entryId);
    // 原始用户记录仍在（只追加，不就地改）
    expect(after.data.records.some((record) => record.entry.id === entryId)).toBe(true);
  });

  it("按轮撤销文件改动（F-1.4）：undo_files 删除上一轮新建的文件", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const madeFile = join(dir, "made-by-agent.txt");
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: madeFile, content: "内容" } }] },
      { text: "写好了" },
      { toolCalls: [{ name: "undo_files", args: {} }] },
      { text: "已撤销" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "写个文件" } });
    await waitForSettles(client, 1);
    expect(await readFile(madeFile, "utf8")).toBe("内容");

    await command(client, "prompt", { sessionId, args: { text: "撤销上一轮的文件改动" } });
    // 注意：waitFor("agent_settled") 会命中第一轮的旧事件，必须等"第 2 次"。
    await waitForSettles(client, 2);
    const undone = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    // 先看工具到底报告了什么（空日志与真撤销的文案不同），失败时能一眼看出原因。
    const undoneText = JSON.stringify(undone.data.records.slice(-4));
    expect(undoneText, `撤销轮末尾记录：${undoneText}`).toContain("已把上一轮改动");
    await expect(readFile(madeFile, "utf8")).rejects.toThrow();
  });

  it("提问超时自动继续（F-1.11）：无人应答时给 agent 追一条「按最佳判断继续」", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    // confirm 自主级别下 write 会触发批准请求；测试客户端有应答能力但**故意不答**，
    // 于是走超时路径（setup 把交互超时设为 2s）。
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: join(dir, "x.txt"), content: "x" } }] },
      { text: "换个办法做了" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "改个文件" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    // 超时后核心层把"按最佳判断继续"追给 agent：模型请求里应出现这句。
    expect(JSON.stringify(fake.requests)).toContain("最佳判断");
  });
});

describe("核心层：工作区查询（F-2.7/F-2.8）", () => {
  it("文件树、变更与文件预览经结构化通道返回（不解析命令输出）", async () => {
    const { core: target, projectDir: dir } = await setup();
    await writeFile(join(dir, "hello.txt"), "文件内容");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "a.ts"), "export {};");

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await client.send({
      type: "channel.open",
      channelId: "ws-1",
      channel: "workspace",
      params: {},
    });
    await client.waitFor("channel.opened" as never, undefined, 5_000);

    await client.send({
      type: "channel.request",
      id: "r-tree",
      channelId: "ws-1",
      method: "tree",
      params: {},
    });
    const tree = await waitForChannel<{
      success: boolean;
      data: { entries: { path: string; kind: string }[] };
    }>(client, "r-tree");
    expect(tree.success).toBe(true);
    const paths = tree.data.entries.map((entry) => entry.path);
    expect(paths).toContain("hello.txt");
    expect(paths).toContain("sub/a.ts");

    await client.send({
      type: "channel.request",
      id: "r-read",
      channelId: "ws-1",
      method: "read",
      params: { path: "sub/a.ts" },
    });
    const file = await waitForChannel<{
      success: boolean;
      data: { path: string; content: string; truncated: boolean };
    }>(client, "r-read");
    expect(file.success).toBe(true);
    expect(file.data.content).toContain("export {}");

    // 越界路径必须被拒（工作区查询不得读出工作区之外）。
    await client.send({
      type: "channel.request",
      id: "r-escape",
      channelId: "ws-1",
      method: "read",
      params: { path: "../../etc/hosts" },
    });
    const outside = await waitForChannel<{ success: boolean }>(client, "r-escape");
    expect(outside.success).toBe(false);
  });
});

describe("核心层：Wiki 生成（F-2.6）", () => {
  it("agent 触发生成：过滤后读文件、模型产出落盘、再读回", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    await writeFile(join(dir, "README.md"), "# 项目说明");
    await writeFile(join(dir, ".env"), "SECRET=1"); // 必须被过滤掉
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await writeFile(join(dir, "node_modules", "x.js"), "module.exports = {}");

    fake.queue([
      { toolCalls: [{ name: "wiki", args: { action: "generate" } }] },
      { text: "# Wiki\n\n## 概览\n这是生成的项目说明。" }, // 生成用的一次性会话
      { text: "已生成" }, // 主对话收尾
      { toolCalls: [{ name: "wiki", args: { action: "read" } }] },
      { text: "读回来了" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "生成项目 wiki" } });
    await waitForSettles(client, 1);

    // 产物落进数据层，内容就是模型的输出。
    const wiki = await readFile(wikiFileFor(dataDir as string, dir), "utf8");
    expect(wiki).toContain("# Wiki");
    // 工具回执里应能看到"敏感文件被排除"——证明 .env 没被读进上下文。
    const first = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    const firstText = JSON.stringify(first.data.records);
    expect(firstText).toContain("敏感文件");
    expect(firstText).not.toContain("SECRET=1");

    await command(client, "prompt", { sessionId, args: { text: "把 wiki 读回来" } });
    await waitForSettles(client, 2);
    const second = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    expect(JSON.stringify(second.data.records)).toContain("这是生成的项目说明");
  });
});

describe("核心层：AI SSH（F-6.5）", () => {
  it("agent 可登记并列出连接；注册表里不存密钥", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([
      {
        toolCalls: [
          {
            name: "ssh",
            args: { action: "add", name: "prod", host: "example.com", user: "deploy", port: 2222 },
          },
        ],
      },
      { text: "登记好了" },
      { toolCalls: [{ name: "ssh", args: { action: "list" } }] },
      { text: "列好了" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "登记一台机器" } });
    await waitForSettles(client, 1);

    const raw = await readFile(join(dataDir as string, "ssh.json"), "utf8");
    expect(raw).toContain("example.com");
    expect(raw).toContain("deploy");
    for (const forbidden of ["password", "privateKey", "passphrase"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    await command(client, "prompt", { sessionId, args: { text: "列一下连接" } });
    await waitForSettles(client, 2);
    const history = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    expect(JSON.stringify(history.data.records)).toContain("deploy@example.com:2222");
  });
});

describe("核心层：外部 Agent 导入（F-3.9）", () => {
  it("扫描并导入外部命令：复制进数据层、留来源标记、源文件不动", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const sourceFile = join(dir, "commands", "review.md");
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(sourceFile, "---\ndescription: 审查\n---\n请审查这段代码。\n");

    fake.queue([
      { toolCalls: [{ name: "import_external", args: { action: "scan" } }] },
      { text: "扫到了" },
      { toolCalls: [{ name: "import_external", args: { action: "apply" } }] },
      { text: "导入了" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "看看有什么能导入" } });
    await waitForSettles(client, 1);
    const scan = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    expect(JSON.stringify(scan.data.records)).toContain("命令");

    await command(client, "prompt", { sessionId, args: { text: "导入它们" } });
    await waitForSettles(client, 2);

    const imported = await readFile(join(dataDir as string, "prompts", "review.md"), "utf8");
    expect(imported).toContain("importedFrom: commands/review.md");
    expect(imported).toContain("请审查这段代码");
    // 源文件分毫未动（"不改原配置"这条承诺要能验证）。
    expect(await readFile(sourceFile, "utf8")).toContain("description: 审查");
  });
});

describe("核心层：用量统计 / 支持包 / 迁移预检（F-5.6~5.8）", () => {
  it("经协议取用量、导出支持包、做只读迁移预检", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "回答" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "你好" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const usage = await command(client, "stats.usage", {});
    expect(usage.success).toBe(true);
    expect((usage.data as { readable: string }).readable).toContain("次调用");

    const exported = await command(client, "support.export", { args: { maxLogFiles: 1 } });
    expect(exported.success).toBe(true);
    const bundle = exported.data as { file: string; included: string[] };
    expect(bundle.file.endsWith(".json.gz")).toBe(true);
    expect(bundle.included).toContain("config");

    // 预检只读：即使源不存在，命令本身成功，结论是"不能迁移"。
    const preflight = await command(client, "migration.preflight", {
      args: { from: join(dir, "not-a-store") },
    });
    expect(preflight.success).toBe(true);
    expect((preflight.data as { report: { canMigrate: boolean } }).report.canMigrate).toBe(false);
  });
});

describe("核心层：插件市场（F-3.6）", () => {
  it("登记本机源 → 读目录 → 安装 → 已装可见 → 卸载", async () => {
    const { core: target, projectDir: dir } = await setup();
    // 在工作区里造一个本机市场（一个插件、一个提示组件）。
    const pluginDir = join(dir, "market", "demo");
    await mkdir(join(pluginDir, "commands"), { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        description: "演示插件",
        components: { prompts: [{ name: "review", file: "commands/review.md" }] },
      }),
    );
    await writeFile(
      join(pluginDir, "commands", "review.md"),
      "---\ndescription: 审查\n---\n请审查。\n",
    );

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");

    const added = await command(client, "marketplace.add_source", {
      args: { name: "local", kind: "local", location: join(dir, "market") },
    });
    expect(added.success).toBe(true);

    const catalog = await command(client, "marketplace.catalog", { args: { source: "local" } });
    expect(
      (catalog.data as { entries: { name: string }[] }).entries.map((entry) => entry.name),
    ).toEqual(["demo"]);

    const installed = await command(client, "marketplace.install", {
      args: { source: "local", plugin: "demo" },
    });
    expect(installed.success).toBe(true);
    expect((installed.data as { readable: string }).readable).toContain("装好 1 项");
    expect(await readFile(join(dataDir as string, "prompts", "review.md"), "utf8")).toContain(
      "请审查。",
    );

    const overview = await command(client, "marketplace.overview", {});
    const overviewData = overview.data as {
      sources: unknown[];
      installed: { kind: string; name: string }[];
    };
    expect(overviewData.sources).toHaveLength(1);
    expect(
      overviewData.installed.some((item) => item.kind === "prompt" && item.name === "review"),
    ).toBe(true);

    const removed = await command(client, "marketplace.uninstall", {
      args: { kind: "prompt", name: "review" },
    });
    expect(removed.success).toBe(true);
    await expect(
      readFile(join(dataDir as string, "prompts", "review.md"), "utf8"),
    ).rejects.toThrow();
  });
});
