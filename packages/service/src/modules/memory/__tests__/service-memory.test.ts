// 服务层通过协议驱动记忆域的端到端测试。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  connect,
  dataDir,
  handshake,
  projectDir,
  setup,
  teardown,
} from "../../../testing/service-harness.ts";
import { memoryDirFor } from "../index.ts";

afterEach(() => teardown());

describe("服务层：记忆（F-2.5）", () => {
  it("memory 工具经服务层可达：脚本化的工具调用把事实落进数据层", async () => {
    const { core: target, provider: fake } = await setup();
    // 假供应商先发起一次 memory 工具调用，再由服务层/基座执行，最后收尾。
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
