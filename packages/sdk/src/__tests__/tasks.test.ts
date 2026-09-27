import type { Transport } from "@ucode/protocol";
import { describe, expect, it } from "vitest";
import { connect } from "../agent-sdk.ts";

/**
 * 自动化任务的 SDK 面（F-4.5）：命令发对了、应答映射进了状态。
 *
 * 用假传输按命令名自动应答，专测"命令面 → 状态"的映射，不依赖核心层进程。
 */

const WELCOME = {
  type: "welcome",
  protocolVersion: 1,
  coreId: "core-test",
  capabilities: ["sessions.read", "sessions.write", "prompt.run"],
  grantedCapabilities: ["sessions.read", "sessions.write", "prompt.run"],
  trustLevel: "local",
  dataLayerVersion: 1,
  sessions: [],
  resumeAck: null,
};

type SentCommand = { id: string; command: string; args: Record<string, unknown> };

function makeTransport(reply: (command: string, args: Record<string, unknown>) => unknown): {
  transport: Transport;
  commands: SentCommand[];
  emit(raw: unknown): void;
} {
  const messageHandlers: ((raw: unknown) => void)[] = [];
  const commands: SentCommand[] = [];
  let resolveReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const transport: Transport = {
    kind: "http",
    send(message) {
      const envelope = message as { type?: string; id?: string; command?: string; args?: unknown };
      if (envelope.type !== "command" || envelope.command === undefined) return;
      const args = (envelope.args ?? {}) as Record<string, unknown>;
      commands.push({ id: envelope.id ?? "", command: envelope.command, args });
      const data = reply(envelope.command, args);
      // 应答异步回送，贴近真实链路。
      queueMicrotask(() => {
        for (const handler of messageHandlers) {
          handler({
            type: "response",
            id: envelope.id,
            command: envelope.command,
            success: true,
            data,
          });
        }
      });
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose() {},
    onError() {},
    async close() {},
    ready: () => ready,
  };
  resolveReady?.();
  return {
    transport,
    commands,
    emit(raw) {
      for (const handler of messageHandlers) handler(raw);
    },
  };
}

const drain = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function connectedSdk(reply: (command: string, args: Record<string, unknown>) => unknown) {
  const harness = makeTransport(reply);
  const sdk = await connect({ transport: harness.transport, clientId: "t", clientKind: "test" });
  const welcome = sdk.connect();
  await drain();
  harness.emit(WELCOME);
  await welcome; // connect() 解析为 welcome，sdk 本身要先拿到
  return { sdk, ...harness };
}

const TASK = {
  id: "t-abc",
  kind: "cron",
  status: "active",
  prompt: "巡检",
  cwd: "/work",
  runs: [],
  skipped: [],
  nextRunAt: "2026-03-01T10:05:00.000Z",
};

describe("任务命令面", () => {
  it("taskList 取回任务并写入状态（含 keepAwake）", async () => {
    const { sdk, commands } = await connectedSdk(() => ({ tasks: [TASK], keepAwake: true }));
    const tasks = await sdk.taskList();
    expect(commands.some((entry) => entry.command === "task.list")).toBe(true);
    expect(tasks).toHaveLength(1);
    expect(sdk.state.tasks.map((task) => task.id)).toEqual(["t-abc"]);
    expect(sdk.state.keepAwake).toBe(true);
  });

  it("taskCreate 只发非空字段，并在之后刷新列表", async () => {
    const { sdk, commands } = await connectedSdk((command) =>
      command === "task.create" ? { task: TASK } : { tasks: [TASK], keepAwake: true },
    );
    await sdk.taskCreate({ kind: "cron", prompt: "巡检", cron: "*/5 * * * *" });
    const create = commands.find((entry) => entry.command === "task.create");
    expect(create?.args).toEqual({ kind: "cron", prompt: "巡检", cron: "*/5 * * * *" });
    // 创建后自动刷新，状态里能看到新任务
    expect(commands.filter((entry) => entry.command === "task.list").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(sdk.state.tasks).toHaveLength(1);
  });

  it("pause / resume / run / cancel 都带上 taskId", async () => {
    const { sdk, commands } = await connectedSdk((command) =>
      command === "task.list" ? { tasks: [], keepAwake: false } : {},
    );
    await sdk.taskPause("t-abc");
    await sdk.taskResume("t-abc");
    await sdk.taskRun("t-abc");
    await sdk.taskCancel("t-abc");
    const byCommand = new Map(commands.map((entry) => [entry.command, entry.args]));
    expect(byCommand.get("task.pause")).toEqual({ taskId: "t-abc" });
    expect(byCommand.get("task.resume")).toEqual({ taskId: "t-abc" });
    expect(byCommand.get("task.run")).toEqual({ taskId: "t-abc" });
    expect(byCommand.get("task.cancel")).toEqual({ taskId: "t-abc" });
  });
});
