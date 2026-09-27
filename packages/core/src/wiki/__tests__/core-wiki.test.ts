// 核心层 Wiki 生成的端到端测试。

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { wikiFileFor } from "../generate.ts";

afterEach(() => teardown());

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
