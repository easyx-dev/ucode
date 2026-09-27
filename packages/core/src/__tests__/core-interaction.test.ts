// 核心层交互面（批准）与降级的端到端测试。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerMessage } from "@ucode/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { command, connect, handshake, setup, teardown } from "../testing/core-harness.ts";

afterEach(() => teardown());

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
