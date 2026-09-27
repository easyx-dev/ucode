// 核心层自动化任务的端到端测试。

import { afterEach, describe, expect, it } from "vitest";
import { command, connect, handshake, setup, teardown } from "../../testing/core-harness.ts";

afterEach(() => teardown());

describe("核心层：自动化任务（F-4.1~4.3）", () => {
  it("经协议创建定时任务、列出、立即运行：驱动出一个会话并记录历史", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    fake.queue([{ text: "任务执行完毕" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");

    const created = await command(client, "task.create", {
      args: { kind: "cron", delayMinutes: 60, prompt: "做点事", cwd: dir },
    });
    expect(created.success).toBe(true);
    const task = (created.data as { task: { id: string; nextRunAt: string } }).task;
    expect(task.id).toBeTruthy();
    expect(task.nextRunAt).toBeTruthy();

    const listed = await command(client, "task.list", {});
    expect((listed.data as { tasks: unknown[] }).tasks).toHaveLength(1);
    expect((listed.data as { keepAwake: boolean }).keepAwake).toBe(true); // F-4.4

    const ran = await command(client, "task.run", { args: { taskId: task.id } });
    expect(ran.success).toBe(true);
    const run = (ran.data as { run: { sessionId: string; status: string } }).run;
    expect(run.status).toBe("completed");
    expect(run.sessionId).toBeTruthy();

    // 任务确实驱动出了会话（模型输出落盘），而不是"记了一笔却没跑"。
    const history = await command(client, "session.get_entries", {
      sessionId: run.sessionId,
      args: { fromSeq: 0 },
    });
    expect(JSON.stringify((history.data as { records: unknown[] }).records)).toContain(
      "任务执行完毕",
    );

    // 运行历史被持久化
    const after = await command(client, "task.list", {});
    const tasks = (after.data as { tasks: Array<{ id: string; runs: unknown[] }> }).tasks;
    expect(tasks[0]?.runs).toHaveLength(1);

    const cancelled = await command(client, "task.cancel", { args: { taskId: task.id } });
    expect(cancelled.success).toBe(true);
  });

  it("未认证通路不能创建自动执行任务（越权任务被挡）", async () => {
    const { core: target, projectDir: dir } = await setup();
    const client = connect(target, "untrusted");
    await handshake(client);
    await client.waitFor("welcome");

    const denied = await command(client, "task.create", {
      args: { kind: "cron", delayMinutes: 1, prompt: "x", cwd: dir, autonomy: "full-access" },
    });
    expect(denied.success).toBe(false);
    // 未认证通路连 sessions.write 都没有，在能力校验处就被挡（比 autonomy 校验更早）。
    expect(denied.error?.code).toBe("unsupported_capability");
    expect(denied.error?.details).toMatchObject({ needed: "sessions.write" });
  });
});
