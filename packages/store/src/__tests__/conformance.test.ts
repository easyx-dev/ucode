import { type ConformanceEnv, createConformanceSuite } from "@ucode/data-layer-spec";
import { describe, expect, it } from "vitest";
import { openStore } from "../open-store.ts";

/**
 * 协议 D 一致性套件（spec §7.3）。
 *
 * 套件本身在 `@ucode/data-layer-spec` 里，这里只做两件事：
 * 把工厂传进去、把用例映射到测试框架。**换实现只换工厂，用例不动。**
 */

const factory = openStore;

const env: ConformanceEnv = {
  // 每个用例自己造临时目录，这里的字段只是类型占位（run 会覆盖）。
  dataDir: "",
  factory,
  openSecondStore: () => factory({ dataDir: "" }),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

describe("协议 D 一致性套件", () => {
  for (const testCase of createConformanceSuite(factory)) {
    it(testCase.name, async () => {
      await testCase.run(env);
    });
  }
});

describe("参考实现的额外约束", () => {
  it("会话文件名与目录编码和基座一致（数据层是 pi 布局的超集）", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join, basename } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "store-shape-"));
    const store = await openStore({ dataDir: dir });
    try {
      const cwd = "/Users/someone/code/project/app";
      const repo = await store.createSession({ cwd });
      // 目录：--Users-someone-code-project-app--
      expect(basename(join(repo.file, ".."))).toBe("--Users-someone-code-project-app--");
      // 文件名：<ISO 把 :/. 换成 ->_<id>.jsonl
      expect(basename(repo.file)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_.+\.jsonl$/);
      expect(basename(repo.file)).toContain(`_${repo.id}.jsonl`);
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("另一个实例的追加会让索引失效（多实例共享一个数据层）", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "store-index-fresh-"));
    const writer = await openStore({ dataDir: dir });
    const reader = await openStore({ dataDir: dir });
    try {
      const repo = await writer.createSession({ cwd: dir });
      // 读者先建一次索引（此时 0 条记录）
      const before = await reader.listSessions();
      expect(before[0]?.entryCount).toBe(0);

      // 写者追加（读者不知道发生了什么——两条进程本来就是这么共享目录的）
      await writer.openSession(repo.id);
      const writable = await writer.openSession(repo.id);
      await writable?.append({ type: "message", message: { role: "user", content: "来自写者" } });

      const after = await reader.listSessions();
      expect(after[0]?.entryCount).toBe(1);
      expect(after[0]?.firstMessage).toBe("来自写者");
    } finally {
      await writer.close();
      await reader.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("索引会因数据变化而失效（新建会话立刻出现在列表里）", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "store-index-"));
    const store = await openStore({ dataDir: dir });
    try {
      expect((await store.listSessions()).length).toBe(0);
      const first = await store.createSession({ cwd: dir });
      expect((await store.listSessions()).map((session) => session.id)).toEqual([first.id]);
      const second = await store.createSession({ cwd: dir });
      const ids = (await store.listSessions()).map((session) => session.id).sort();
      expect(ids).toEqual([first.id, second.id].sort());
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
