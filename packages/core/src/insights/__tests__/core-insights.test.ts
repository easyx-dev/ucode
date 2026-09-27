// 核心层用量统计 / 支持包 / 迁移预检的端到端测试。

import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { command, connect, handshake, setup, teardown } from "../../testing/core-harness.ts";

afterEach(() => teardown());

describe("核心层：用量统计 / 支持包 / 迁移预检（F-5.6~5.8）", () => {
  it("经协议取用量、导出支持包、做只读迁移预检", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "回答" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "你好" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const usage = await command(client, "stats.usage", {});
    expect(usage.success).toBe(true);
    expect((usage.data as { readable: string }).readable).toContain("次调用");

    const exported = await command(client, "support.export", { args: { maxLogFiles: 1 } });
    expect(exported.success).toBe(true);
    const bundle = exported.data as { file: string; included: string[] };
    expect(bundle.file.endsWith(".json.gz")).toBe(true);
    expect(bundle.included).toContain("config");

    // 预检只读：即使源不存在，命令本身成功，结论是"不能迁移"。
    const preflight = await command(client, "migration.preflight", {
      args: { from: join(dir, "not-a-store") },
    });
    expect(preflight.success).toBe(true);
    expect((preflight.data as { report: { canMigrate: boolean } }).report.canMigrate).toBe(false);
  });
});
