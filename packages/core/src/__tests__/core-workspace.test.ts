// 核心层工作区查询的端到端测试。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  connect,
  handshake,
  setup,
  teardown,
  waitForChannel,
} from "../testing/core-harness.ts";

afterEach(() => teardown());

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
