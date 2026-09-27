// 核心层 AI SSH 的端到端测试。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  connect,
  dataDir,
  type EntryRecord,
  handshake,
  setup,
  teardown,
  waitForSettles,
} from "../../testing/core-harness.ts";

afterEach(() => teardown());

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
