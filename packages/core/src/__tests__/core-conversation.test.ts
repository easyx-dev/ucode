// 核心层一轮完整对话（M2 验收）的端到端测试。

import { readFile } from "node:fs/promises";
import type { ServerMessage } from "@ucode/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  connect,
  handshake,
  projectDir,
  setup,
  teardown,
} from "../testing/core-harness.ts";

afterEach(() => teardown());

describe("核心层：一轮完整对话（M2 验收）", () => {
  it("握手 → 新建会话 → 对话 → 完整事件流 → 取回历史", async () => {
    const { core: target, provider: fake } = await setup();
    fake.queue([{ text: "第一轮回答。" }]);
    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");

    const created = await command(client, "session.create", { args: { cwd: projectDir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    expect(sessionId).toBeTruthy();

    const attached = await command(client, "session.attach", { sessionId });
    expect(attached.success).toBe(true);

    const prompted = await command(client, "prompt", { sessionId, args: { text: "你好" } });
    expect(prompted.success).toBe(true);

    const settled = await client.waitFor("agent_settled", undefined, 15_000);
    expect(settled.type).toBe("agent_settled");

    // 事件面：流式增量（非权威）+ 落盘记录（权威）
    const deltas = client.messages.filter((message) => message.type === "message_delta");
    expect(deltas.length, "应收到流式增量").toBeGreaterThan(0);
    const appended = client.messages.filter(
      (message): message is Extract<ServerMessage, { type: "entry_appended" }> =>
        message.type === "entry_appended",
    );
    expect(appended.length, "应收到落盘记录").toBeGreaterThan(0);
    expect(
      appended.every((message) => message.seq > 0),
      "记录必须带游标（行序号）",
    ).toBe(true);
    expect(client.messages.some((message) => message.type === "turn_end")).toBe(true);

    // 历史：从数据层取回（权威在磁盘，不在内存）
    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (
      history.data as {
        records: { seq: number; entry: { type: string; message?: { role?: string } } }[];
      }
    ).records;
    const roles = records
      .filter((record) => record.entry.type === "message")
      .map((record) => record.entry.message?.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    const cursor = (history.data as { cursor: number }).cursor;
    expect(cursor).toBeGreaterThanOrEqual(records.length);

    // 会话文件本身：pi 兼容的 JSONL（header 在第一行）
    const state = await command(client, "session.get_state", { sessionId });
    const sessionFile = (await target.store.listSessions()).find(
      (session) => session.id === sessionId,
    )?.file;
    expect(sessionFile).toBeTruthy();
    const content = await readFile(sessionFile as string, "utf8");
    const lines = content.trimEnd().split("\n");
    const header = JSON.parse(lines[0] as string) as { type: string; version: number; id: string };
    expect(header.type).toBe("session");
    expect(header.version).toBe(3);
    expect(header.id).toBe(sessionId);
    expect(lines.length).toBe(cursor + 1);
    expect((state.data as { state: { status: string } }).state.status).toBe("idle");
  });
});
