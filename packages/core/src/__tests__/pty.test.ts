import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Core, createCore } from "../core.ts";

/**
 * PTY 通道的端到端测试（spec §4.7 第 2 条，V-7）。
 *
 * 走协议帧的全链路：channel.open(pty) → channel.data（上行写入，下行回读）→ resize → 退出。
 * 字节用 base64 承载——验证的就是控制层实际收发的那条路径。
 */

let core: Core | undefined;
let dir: string | undefined;

afterEach(async () => {
  await core?.close().catch(() => undefined);
  core = undefined;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("PTY 通道", () => {
  it("打开 → 写入命令 → 收到回显与执行输出 → resize → 退出", async () => {
    dir = await mkdtemp(join(tmpdir(), "pty-e2e-"));
    core = await createCore({ dataDir: dir, cwd: dir });
    const messages: unknown[] = [];
    const handle = core.attachConnection({
      binding: "test",
      trustLevel: "implicit",
      send: (message) => messages.push(message),
    });
    await handle.receive({
      type: "hello",
      protocolVersion: 1,
      clientId: "pty-test",
      clientKind: "test",
      binding: "test",
      capabilities: ["sessions.read", "channel.pty"],
    });

    await handle.receive({
      type: "channel.open",
      channelId: "pty-1",
      channel: "pty",
      params: { cols: 100, rows: 30, cwd: dir },
    });
    const opened = messages.findLast(
      (message) => (message as { type: string }).type === "channel.opened",
    );
    expect(opened).toBeTruthy();

    // 等 shell 就绪（zsh 启动可能有输出）
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 写入命令（base64）
    const command = "echo pty-channel-ok\r";
    await handle.receive({
      type: "channel.data",
      channelId: "pty-1",
      data: Buffer.from(command, "utf8").toString("base64"),
    });

    // 收输出直到出现执行结果
    const deadline = Date.now() + 10_000;
    let output = "";
    const sawResizeAck = false;
    while (Date.now() < deadline && !output.includes("pty-channel-ok")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (const message of messages) {
        if ((message as { type: string }).type !== "channel.data") continue;
        output += Buffer.from((message as { data: string }).data, "base64").toString("utf8");
      }
    }
    expect(output).toContain("pty-channel-ok");

    // resize：改小窗口后 stty size 应反映（V-7 的验收方式）
    await handle.receive({ type: "channel.resize", channelId: "pty-1", cols: 60, rows: 20 });
    await handle.receive({
      type: "channel.data",
      channelId: "pty-1",
      data: Buffer.from("stty size\r", "utf8").toString("base64"),
    });
    while (Date.now() < deadline && !output.includes("stty size")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (const message of messages) {
        if ((message as { type: string }).type !== "channel.data") continue;
        output += Buffer.from((message as { data: string }).data, "base64").toString("utf8");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    for (const message of messages) {
      if ((message as { type: string }).type !== "channel.data") continue;
      output += Buffer.from((message as { data: string }).data, "base64").toString("utf8");
    }
    expect(output).toMatch(/20 60/);
    expect(sawResizeAck || output.includes("20 60")).toBe(true);

    // 关闭通道：shell 退出（kill → onExit → channel.closed，异步链）
    await handle.receive({ type: "channel.close", channelId: "pty-1" });
    const closeDeadline = Date.now() + 5_000;
    let closed: unknown;
    while (Date.now() < closeDeadline) {
      closed = messages.findLast(
        (message) => (message as { type: string }).type === "channel.closed",
      );
      if (closed !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(closed).toBeTruthy();
  }, 30_000);

  it("untrusted 通路打开 PTY：被拒（会在主机上开交互式 shell）", async () => {
    dir = await mkdtemp(join(tmpdir(), "pty-untrusted-"));
    core = await createCore({ dataDir: dir, cwd: dir });
    const messages: unknown[] = [];
    const handle = core.attachConnection({
      binding: "http",
      trustLevel: "untrusted",
      send: (message) => messages.push(message),
    });
    await handle.receive({
      type: "hello",
      protocolVersion: 1,
      clientId: "u1",
      clientKind: "web",
      binding: "http",
      capabilities: ["channel.pty"],
    });
    await handle.receive({ type: "channel.open", channelId: "pty-x", channel: "pty", params: {} });
    const closed = messages.findLast(
      (message) => (message as { type: string }).type === "channel.closed",
    );
    expect(closed).toBeTruthy();
    expect((closed as { reason: string }).reason).toContain("untrusted");
  });
});
