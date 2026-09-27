// 服务层目标模式的端到端测试。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  connect,
  type EntryRecord,
  handshake,
  setup,
  teardown,
} from "../../../testing/service-harness.ts";

afterEach(() => teardown());

describe("服务层：目标模式（F-1.6）", () => {
  it("设定目标后自动续跑，达额度上限自动暂停", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    // 请求顺序：① 设目标 → ② A 轮 → ③ 校验 NO → ④ B 轮 → ⑤ 校验 NO → ⑥ C 轮（达上限，不再校验）
    fake.queue([
      {
        toolCalls: [
          { name: "goal", args: { action: "set", objective: "完成三件事", maxContinuations: 2 } },
        ],
      },
      { text: "第 A 轮进展" },
      { text: "NO" },
      { text: "第 B 轮进展" },
      { text: "NO" },
      { text: "第 C 轮进展" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    // 只发一次 prompt：B、C 两轮是系统自动续跑出来的。
    await command(client, "prompt", { sessionId, args: { text: "开始推进目标" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (history.data as { records: EntryRecord[] }).records;
    const json = JSON.stringify(records);
    expect(json).toContain("第 A 轮进展");
    expect(json, "应自动续跑到第二轮").toContain("第 B 轮进展");
    expect(json, "应自动续跑到第三轮").toContain("第 C 轮进展");

    const goalEntries = records.filter((record) => record.entry.customType === "goal");
    expect(goalEntries.length, "目标状态应被持久化").toBeGreaterThan(0);
    const last = goalEntries.at(-1)?.entry.data as { status: string; continuations: number };
    expect(last.status).toBe("paused");
    expect(last.continuations).toBe(2);
  });

  it("计划模式下不能设目标（两者互斥）", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([
      { toolCalls: [{ name: "goal", args: { action: "set", objective: "不该成功" } }] },
      { text: "好" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "plan" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "定个目标" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (history.data as { records: EntryRecord[] }).records;
    expect(JSON.stringify(records)).toContain("计划模式下不能设置目标");
    expect(records.filter((record) => record.entry.customType === "goal")).toHaveLength(0);
  });

  it("计划模式本身：改动类工具被拦下（只读地规划）", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const blockedFile = join(dir, "plan-should-not-write.txt");
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: blockedFile, content: "x" } }] },
      { text: "好" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "plan" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "改个文件" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    await expect(readFile(blockedFile, "utf8")).rejects.toThrow();
  });
});
