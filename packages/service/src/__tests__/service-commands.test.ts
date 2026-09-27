// 服务层命令面细节的端到端测试。

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerMessage } from "@ucode/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { command, connect, handshake, setup, teardown } from "../testing/service-harness.ts";

afterEach(() => teardown());

describe("服务层：命令面细节", () => {
  it("工作区查询通道：文件树与 Git 变更（工作区在服务层这台机器上）", async () => {
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
