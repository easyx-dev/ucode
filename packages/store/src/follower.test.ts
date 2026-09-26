import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { followSession } from "./follower.ts";
import { openStore } from "./open-store.ts";

/**
 * 跟随（ADR-008）：非 owner 实例靠跟文件拿到实时进展。
 *
 * 三个坑都在这里被钉住（spec §3.12、V-10）：
 * 1. `fs.watch` 会漏事件 → 有轮询兜底，最终一致；
 * 2. 崩溃尾部不完整 → 只认完整行（由 SessionRepo.read 保证）；
 * 3. **迁移是原地重写**（inode 不变）→ 必须靠"前缀是否还一致"识别，并发出重同步信号。
 */

let dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "follower-"));
  dirs.push(dir);
  const writer = await openStore({ dataDir: dir });
  const reader = await openStore({ dataDir: dir });
  const repo = await writer.createSession({ cwd: dir });
  return { dir, writer, reader, repo };
}

function waitFor(predicate: () => boolean, timeoutMs = 6_000, description = "条件"): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`等待${description}超时`));
      }
    }, 20);
  });
}

describe("跟随：数据层文件兼作事件总线", () => {
  it("owner 追加的记录会被跟随者收到（轮询兜底，不依赖 fs.watch 一次不落）", async () => {
    const { writer, reader, repo } = await setup();
    const opened = await reader.openSession(repo.id);
    expect(opened).toBeDefined();

    const seen: string[] = [];
    const follower = await followSession(opened as never, {
      onEntries: (records) => {
        for (const record of records) seen.push(record.entry.id);
      },
      onResync: () => undefined,
    });

    // owner 侧连追加多条：即便 fs.watch 合并/丢了事件，也必须最终全部到齐
    const ownerRepo = await writer.openSession(repo.id);
    const appended: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const record = await ownerRepo?.append({
        type: "custom",
        customType: "probe",
        data: { index },
      });
      if (record !== undefined) appended.push(record.entry.id);
    }

    await waitFor(() => seen.length >= appended.length, 8_000, "跟随者收到全部追加");
    expect(seen.slice(0, appended.length)).toEqual(appended);
    expect(follower.cursor()).toBeGreaterThanOrEqual(appended.length);

    follower.stop();
    await writer.close();
    await reader.close();
  });

  it("崩溃尾部：半行不算数据；处置后不惊扰跟随者；记录变少才发重同步", async () => {
    const { writer, repo, reader } = await setup();
    const ownerRepo = await writer.openSession(repo.id);
    await ownerRepo?.append({ type: "custom", customType: "probe", data: { ok: 1 } });

    const opened = await reader.openSession(repo.id);
    const seen: number[] = [];
    const resyncs: { cursor: number; reason: string }[] = [];
    const follower = await followSession(opened as never, {
      onEntries: (records) => {
        for (const record of records) seen.push(record.seq);
      },
      onResync: (cursor, reason) => {
        resyncs.push({ cursor, reason });
      },
    });
    // 跟随的语义是"从现在起"：挂载时的存量由 session.attach 的重放负责，跟随只报新增。
    // 模拟 owner 崩溃：文件尾部多了半行（没有换行结尾）
    await appendFile(repo.file, '{"type":"custom","id":"partial"', "utf8");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(seen, "半行不该被当成记录").toEqual([]);

    // 接管者处置尾部：**解析后的记录没有变**，跟随者不该被惊扰
    const repaired = await ownerRepo?.repairTail();
    expect(repaired?.truncatedBytes ?? 0).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(seen).toEqual([]);
    expect(resyncs).toEqual([]);

    // 处置后继续追加：按新游标上报
    await ownerRepo?.append({ type: "custom", customType: "probe", data: { ok: 2 } });
    await waitFor(() => seen.length >= 1, 8_000, "处置后的新记录");
    expect(seen).toEqual([2]);
    expect(follower.cursor()).toBe(2);

    // 记录变少（比崩溃处置更激进的重写）：必须发重同步信号
    const content = await readFile(repo.file, "utf8");
    const headerLine = content.split("\n")[0] as string;
    await writeFile(repo.file, `${headerLine}\n`, "utf8");
    await waitFor(() => resyncs.length >= 1, 8_000, "记录变少的重同步信号");
    expect(resyncs[0]?.reason).toBe("truncated_tail");
    expect(resyncs[0]?.cursor).toBe(0);

    follower.stop();
    await writer.close();
    await reader.close();
  });

  it("整体替换（原地重写、inode 不变）：跟随者收到重同步信号", async () => {
    const { writer, reader, repo } = await setup();
    const ownerRepo = await writer.openSession(repo.id);
    await ownerRepo?.append({ type: "custom", customType: "probe", data: { n: 1 } });

    const opened = await reader.openSession(repo.id);
    let resync: { cursor: number; reason: string } | null = null;
    const follower = await followSession(opened as never, {
      onEntries: () => undefined,
      onResync: (cursor, reason) => {
        resync = { cursor, reason };
      },
    });

    // 模拟格式迁移：同一 inode 上原地重写（内容前缀断裂）
    const original = await readFile(repo.file, "utf8");
    const lines = original.split("\n").filter((line) => line !== "");
    const migrated = `${lines[0] as string}\n${JSON.stringify({
      type: "custom",
      id: "migrated1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      customType: "migrated",
    })}\n`;
    await writeFile(repo.file, migrated, "utf8");

    await waitFor(() => resync !== null, 8_000, "重同步信号");
    // TS 的控制流分析不知道回调改过它，这里显式取快照
    const observed = resync as unknown as { cursor: number; reason: string };
    expect(observed.reason).toBe("migration");
    expect(observed.cursor).toBe(1);

    follower.stop();
    await writer.close();
    await reader.close();
  });
});
