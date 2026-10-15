/** 终端池：起进程、合批分发、回放缓冲与裁剪、退出与关闭 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { TerminalPool, type TerminalSpawnSpec, type TerminalSubscriber } from "../terminals";

/** 等待条件成立；超时即失败（终端输出是异步的，断言前要等它到） */
const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** 各平台都能跑的 shell 与「打印一段文本」的写法 */
const shellOf = (): string =>
  process.platform === "win32"
    ? (process.env.ComSpec ?? "cmd.exe")
    : (process.env.SHELL ?? "/bin/bash");

const printSpec = (text: string): TerminalSpawnSpec =>
  process.platform === "win32"
    ? { file: shellOf(), args: ["/c", `echo ${text}`], env: process.env }
    : { file: shellOf(), args: ["-c", `printf '%s\\n' ${text}`], env: process.env };

/** 交互态：起一个不退出、等输入的 shell */
const interactiveSpec = (): TerminalSpawnSpec =>
  process.platform === "win32"
    ? { file: shellOf(), args: [], env: process.env }
    : { file: shellOf(), args: ["-i"], env: { ...process.env, PS1: "" } };

const decode = (chunks: readonly Buffer[]): string => Buffer.concat([...chunks]).toString("utf8");

/** 收输出的订阅者：把分片与结束信号分别记下来 */
const collector = () => {
  const chunks: Buffer[] = [];
  const exits: number[] = [];
  const subscriber: TerminalSubscriber = {
    onData: (chunk) => chunks.push(chunk),
    onExit: (exitCode) => exits.push(exitCode),
  };
  return { chunks, exits, subscriber, text: () => decode(chunks) };
};

describe("TerminalPool", () => {
  let dir: string;
  const pool = new TerminalPool({
    maxPerCwd: 2,
    scrollbackBytes: 512,
    // 合批窗口压到最小：测试要的是「合并过」而不是「等 8ms」
    flushMs: 1,
  });

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "terminal-pool-test-"));
  });

  after(() => {
    pool.disposeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  it("创建后给出可用的视图，并把输出送到订阅者", async () => {
    const info = pool.create({ cwd: dir, cols: 80, rows: 24, spec: printSpec("hello") });
    assert.equal(info.cwd, dir);
    assert.equal(info.running, true);
    assert.ok(info.pid > 0);
    assert.equal(info.exitCode, null);

    const seen = collector();
    const unsubscribe = pool.subscribe(info.id, seen.subscriber);
    assert.ok(unsubscribe);

    await waitFor(() => seen.text().includes("hello"));
    unsubscribe?.();
  });

  it("退出后给出退出码，视图标记为已结束", async () => {
    const info = pool.create({ cwd: dir, cols: 80, rows: 24, spec: printSpec("bye") });
    const seen = collector();
    pool.subscribe(info.id, seen.subscriber);

    await waitFor(() => seen.exits.length > 0);
    assert.equal(seen.exits[0], 0);
    assert.equal(pool.get(info.id)?.running, false);
  });

  it("回放缓冲给新订阅者补上已有输出，并按上限裁剪", async () => {
    // 用交互态连续喂几段，写进去的量明确超过 512 字节的上限
    const info = pool.create({ cwd: dir, cols: 80, rows: 24, spec: interactiveSpec() });
    for (let index = 0; index < 60; index += 1) {
      pool.write(info.id, `printf '%s\\n' ${"x".repeat(120)}\n`);
    }

    const buffered = (): number =>
      (pool.snapshot(info.id) ?? []).reduce((total, chunk) => total + chunk.length, 0);
    await waitFor(() => buffered() > 600);

    // 裁剪按块整块丢，所以落在「上限」与「上限 + 若干块」之间，而不是恰好 512
    const bytes = buffered();
    assert.ok(bytes > 0 && bytes < 2048, `缓冲字节数异常：${bytes}`);
    assert.equal(pool.get(info.id)?.running, true);
  });

  it("resize 把新尺寸交给进程并记进视图", async () => {
    const info = pool.create({ cwd: dir, cols: 80, rows: 24, spec: interactiveSpec() });
    const seen = collector();
    pool.subscribe(info.id, seen.subscriber);

    assert.deepEqual(pool.resize(info.id, 100, 30), { cols: 100, rows: 30 });
    assert.equal(pool.get(info.id)?.cols, 100);

    pool.write(info.id, "tput cols\n");
    await waitFor(() => seen.text().includes("100"));
  });

  it("输入透传到进程", async () => {
    const info = pool.create({ cwd: dir, cols: 80, rows: 24, spec: interactiveSpec() });
    const seen = collector();
    pool.subscribe(info.id, seen.subscriber);

    assert.equal(pool.write(info.id, "printf 'from-input\\n'\n"), true);
    await waitFor(() => seen.text().includes("from-input"));
  });

  it("关闭时订阅者也拿到结束信号（不必等一个不会来的输出）", async () => {
    const info = pool.create({ cwd: dir, cols: 80, rows: 24, spec: interactiveSpec() });
    const seen = collector();
    pool.subscribe(info.id, seen.subscriber);

    assert.equal(pool.close(info.id), true);
    assert.deepEqual(seen.exits, [0]);
  });

  it("关闭后条目消失、进程不再有输出", async () => {
    const info = pool.create({ cwd: dir, cols: 80, rows: 24, spec: interactiveSpec() });
    const seen = collector();
    pool.subscribe(info.id, seen.subscriber);
    pool.write(info.id, "printf 'before-close\\n'\n");
    await waitFor(() => seen.text().includes("before-close"));

    assert.equal(pool.close(info.id), true);
    assert.equal(pool.get(info.id), null);
    assert.equal(pool.snapshot(info.id), null);
    assert.equal(pool.subscribe(info.id, seen.subscriber), null);
    assert.equal(pool.close(info.id), false);

    const seenBytes = seen.chunks.length;
    pool.write(info.id, "printf 'after-close\\n'\n");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(seen.chunks.length, seenBytes);
  });

  it("序号按归属键自增，关掉中间一个也不会让后面的前移", () => {
    const own = mkdtempSync(join(tmpdir(), "terminal-seq-"));
    try {
      const first = pool.create({ cwd: own, cols: 80, rows: 24, spec: interactiveSpec() });
      const second = pool.create({ cwd: own, cols: 80, rows: 24, spec: interactiveSpec() });
      assert.deepEqual([first.sequence, second.sequence], [1, 2]);

      pool.close(first.id);
      const third = pool.create({ cwd: own, cols: 80, rows: 24, spec: interactiveSpec() });
      assert.equal(third.sequence, 3);
      // 另一个目录各算各的
      const other = pool.create({ cwd: dir, cols: 80, rows: 24, spec: interactiveSpec() });
      assert.equal(other.sequence, pool.list(dir).find((item) => item.id === other.id)?.sequence);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it("countRunning 只算在跑的，且按目录分开", async () => {
    // 用全新目录：断言的计数只由本用例创建的终端决定
    const own = mkdtempSync(join(tmpdir(), "terminal-pool-own-"));
    const other = mkdtempSync(join(tmpdir(), "terminal-pool-other-"));
    try {
      const first = pool.create({ cwd: own, cols: 80, rows: 24, spec: interactiveSpec() });
      const second = pool.create({ cwd: own, cols: 80, rows: 24, spec: interactiveSpec() });
      pool.create({ cwd: other, cols: 80, rows: 24, spec: interactiveSpec() });

      assert.equal(pool.countRunning(own), 2);
      assert.equal(pool.countRunning(other), 1);
      assert.equal(pool.list(own).length, 2);

      pool.close(first.id);
      assert.equal(pool.countRunning(own), 1);
      assert.ok(pool.list(own).some((info) => info.id === second.id));

      // 自然退出的进程仍留在清单里（好让界面显示退出码），但不再计入上限
      const quick = pool.create({ cwd: own, cols: 80, rows: 24, spec: printSpec("quick") });
      await waitFor(() => pool.get(quick.id)?.running === false);
      assert.equal(pool.countRunning(own), 1);
      // first 已被 close（条目摘除），剩下 second 与自然退出的 quick
      assert.equal(pool.list(own).length, 2);
    } finally {
      rmSync(own, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});
