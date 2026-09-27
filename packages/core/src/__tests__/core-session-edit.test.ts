// 核心层会话编辑与回退的端到端测试。

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
  waitForSettles,
} from "../testing/core-harness.ts";

afterEach(() => teardown());

describe("核心层：会话编辑与回退（F-1.3/F-1.4/F-1.5/F-1.11）", () => {
  it("辅助对话（临时会话 F-1.5）：可对话、不进列表", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "临时回答" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, ephemeral: true },
    });
    expect(created.success).toBe(true);
    const data = created.data as { sessionId: string; ephemeral?: boolean };
    expect(data.ephemeral).toBe(true);
    expect(data.sessionId.startsWith("eph-")).toBe(true);

    await command(client, "session.attach", { sessionId: data.sessionId });
    await command(client, "prompt", { sessionId: data.sessionId, args: { text: "你好" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const history = await command(client, "session.get_entries", {
      sessionId: data.sessionId,
      args: { fromSeq: 0 },
    });
    expect(
      JSON.stringify((history.data as { records: unknown[] }).records),
      `临时会话的记录：${JSON.stringify((history.data as { records: unknown[] }).records).slice(0, 400)}`,
    ).toContain("临时回答");

    // 临时会话不落文件，因此列表里看不到它（无需在列表处加过滤）。
    const list = await command(client, "session.list", {});
    const sessions = (list.data as { sessions: Array<{ id: string }> }).sessions;
    expect(sessions.some((session) => session.id === data.sessionId)).toBe(false);
  });

  it("编辑历史对话（F-1.3）：追加一条上下文改写，原记录仍在", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "第一轮回答" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "原始问题" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const first = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    const userRecord = first.data.records.find(
      (record) => (record.entry as { message?: { role?: string } }).message?.role === "user",
    );
    expect(userRecord).toBeDefined();
    const entryId = userRecord?.entry.id as string;

    const edited = await command(client, "session.edit_entry", {
      sessionId,
      args: { entryId, content: "改写后的问题" },
    });
    expect(edited.success).toBe(true);

    const after = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    const editRecord = after.data.records.find(
      (record) => (record.entry as { type?: string }).type === "context_edit",
    );
    expect(editRecord, "应追加一条 context_edit（追加式改写，不破坏原记录）").toBeDefined();
    expect(editRecord === undefined ? undefined : editRecord.entry.targetId).toBe(entryId);
    // 原始用户记录仍在（只追加，不就地改）
    expect(after.data.records.some((record) => record.entry.id === entryId)).toBe(true);
  });

  it("按轮撤销文件改动（F-1.4）：undo_files 删除上一轮新建的文件", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const madeFile = join(dir, "made-by-agent.txt");
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: madeFile, content: "内容" } }] },
      { text: "写好了" },
      { toolCalls: [{ name: "undo_files", args: {} }] },
      { text: "已撤销" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "写个文件" } });
    await waitForSettles(client, 1);
    expect(await readFile(madeFile, "utf8")).toBe("内容");

    await command(client, "prompt", { sessionId, args: { text: "撤销上一轮的文件改动" } });
    // 注意：waitFor("agent_settled") 会命中第一轮的旧事件，必须等"第 2 次"。
    await waitForSettles(client, 2);
    const undone = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    // 先看工具到底报告了什么（空日志与真撤销的文案不同），失败时能一眼看出原因。
    const undoneText = JSON.stringify(undone.data.records.slice(-4));
    expect(undoneText, `撤销轮末尾记录：${undoneText}`).toContain("已把上一轮改动");
    await expect(readFile(madeFile, "utf8")).rejects.toThrow();
  });

  it("提问超时自动继续（F-1.11）：无人应答时给 agent 追一条「按最佳判断继续」", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    // confirm 自主级别下 write 会触发批准请求；测试客户端有应答能力但**故意不答**，
    // 于是走超时路径（setup 把交互超时设为 2s）。
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: join(dir, "x.txt"), content: "x" } }] },
      { text: "换个办法做了" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "改个文件" } });
    await client.waitFor("agent_settled", undefined, 20_000);

    // 超时后核心层把"按最佳判断继续"追给 agent：模型请求里应出现这句。
    expect(JSON.stringify(fake.requests)).toContain("最佳判断");
  });
});
