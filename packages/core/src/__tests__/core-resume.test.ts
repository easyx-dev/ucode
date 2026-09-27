// 核心层断线续传与跟读的端到端测试。

import type { ServerMessage } from "@ucode/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { command, connect, handshake, setup, teardown } from "../testing/core-harness.ts";

afterEach(() => teardown());

describe("核心层：断线续传与跟读", () => {
  it("带游标重连：只补齐缺口，且不重复索要已有记录", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "回答一。" }, { text: "回答二。" }]);
    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "第一句" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const cursor = (history.data as { cursor: number }).cursor;
    expect(cursor).toBeGreaterThan(0);

    // 新连接带游标重连：应从 cursor 之后补齐（此时没有新记录 → 只拿到 welcome + resumeAck）
    const resumed = connect(target, "implicit");
    await handshake(resumed, { resume: { sessionId, fromSeq: cursor } });
    const welcome = (await resumed.waitFor("welcome")) as Extract<
      ServerMessage,
      { type: "welcome" }
    >;
    expect(welcome.resumeAck?.valid).toBe(true);
    expect(welcome.resumeAck?.cursor).toBe(cursor);
    const replayed = resumed.messages.filter((message) => message.type === "entry_appended");
    expect(replayed.length).toBe(0);

    // 续跑第二轮：新记录以游标继续递增
    await command(resumed, "prompt", { sessionId, args: { text: "第二句" } });
    await resumed.waitFor("agent_settled", undefined, 15_000);
    const newRecords = resumed.messages.filter(
      (message): message is Extract<ServerMessage, { type: "entry_appended" }> =>
        message.type === "entry_appended",
    );
    expect(newRecords.length).toBeGreaterThan(0);
    expect(Math.min(...newRecords.map((message) => message.seq))).toBeGreaterThan(cursor);
  });
});
