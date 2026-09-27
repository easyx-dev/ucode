import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  connect,
  handshake,
  setup,
  teardown,
  waitForSettles,
} from "../testing/core-harness.ts";

/**
 * `plan` 自主级别的**结构性只读**（spec §2.5）。
 *
 * 只在 `tool_call` 上拦是不够的：模型依然看得到 `write`/`edit` 并反复尝试，每次都被拒一次，
 * 计划模式就变成"每步都撞墙"。所以 plan 档要把改动类工具从工具集里摘掉。
 *
 * 判据取假供应商收到的请求体（它记录了每次调用发给模型的 `tools`）——这比断言内部方法
 * 更硬：它证明的是"模型真的看不到"，而不是"我们调过某个 API"。
 */

afterEach(teardown);

function toolNames(request: { tools: unknown[] } | undefined): string[] {
  return (request?.tools ?? []).map((tool) => {
    const asRecord = tool as { name?: string; function?: { name?: string } };
    return asRecord.function?.name ?? asRecord.name ?? "";
  });
}

function issueId(client: { messages: unknown[] }): string {
  return `cmd-${client.messages.length}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("plan 档：结构性只读", () => {
  it("改动类工具不进模型上下文，只读工具与命令类工具保留", async () => {
    const { core: target, provider, projectDir } = await setup();
    const client = connect(target, "implicit");
    await handshake(client);

    const created = await command(client, "session.create", {
      args: { cwd: projectDir, autonomy: "plan" },
    });
    expect(created.success).toBe(true);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    await client.send({
      type: "command",
      id: issueId(client),
      command: "prompt",
      sessionId,
      args: { text: "先看看这个项目的结构，不要改任何东西。" },
    });
    await waitForSettles(client, 1);

    const names = toolNames(provider.requests.at(-1));
    expect(names.length).toBeGreaterThan(0);
    expect(names, "只读工具应保留").toContain("read");
    expect(names, "命令类工具应保留（由闸门按只读白名单逐条判定）").toContain("bash");
    expect(names, "改动类工具不该出现在模型上下文里").not.toContain("write");
    expect(names).not.toContain("edit");
  });

  it("切回 confirm 后改动类工具恢复（不是一次性阉割）", async () => {
    const { core: target, provider, projectDir } = await setup();
    const client = connect(target, "implicit");
    await handshake(client);

    const created = await command(client, "session.create", {
      args: { cwd: projectDir, autonomy: "plan" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;

    await client.send({
      type: "command",
      id: issueId(client),
      command: "session.set_autonomy",
      sessionId,
      args: { level: "confirm" },
    });
    await client.send({
      type: "command",
      id: issueId(client),
      command: "prompt",
      sessionId,
      args: { text: "现在可以改了。" },
    });
    await waitForSettles(client, 1);

    const names = toolNames(provider.requests.at(-1));
    expect(names).toContain("write");
    expect(names).toContain("edit");
  });
});
