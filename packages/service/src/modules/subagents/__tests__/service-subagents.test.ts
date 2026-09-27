// 服务层通过协议派发子智能体的端到端测试。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { servicePaths } from "../../../paths.ts";
import {
  command,
  connect,
  dataDir,
  handshake,
  setup,
  teardown,
} from "../../../testing/service-harness.ts";

afterEach(() => teardown());

describe("服务层：子智能体（F-2.3/F-3.3）", () => {
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
    await mkdir(join(servicePaths(dataDir as string).piDir, "agents"), { recursive: true });
    await writeFile(
      join(servicePaths(dataDir as string).piDir, "agents", "my-agent.md"),
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
