import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CURRENT_SESSION_VERSION, parseSessionFile, serializeEntry } from "./entries.ts";
import { DataLayerError, type DataLayerErrorCode } from "./errors.ts";
import type { Store, StoreFactory } from "./store.ts";
import { CURRENT_DATA_LAYER_VERSION } from "./version.ts";

/**
 * 协议 D 的一致性套件（spec §7.3 的必测范围）。
 *
 * 用法：任何实现传入自己的工厂函数即跑全套——
 * ```ts
 * for (const testCase of createConformanceSuite(myFactory)) {
 *   it(testCase.name, () => testCase.run(env));
 * }
 * ```
 * 套件不依赖测试框架：失败即抛错，由调用方映射到自己的断言风格。
 */

export type ConformanceEnv = {
  dataDir: string;
  factory: StoreFactory;
  /** 同一数据层上的第二个实例（模拟多进程：两个核心层实例共享一个目录）。 */
  openSecondStore: () => Promise<Store>;
  sleep: (ms: number) => Promise<void>;
};

export type ConformanceCase = {
  name: string;
  run: (env: ConformanceEnv) => Promise<void>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`一致性套件失败：${message}`);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `一致性套件失败：${message}（期望 ${String(expected)}，实际 ${String(actual)}）`,
    );
  }
}

async function assertRejectsCode(
  action: () => Promise<unknown>,
  code: DataLayerErrorCode,
  message: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DataLayerError && error.code === code) return;
    throw new Error(
      `一致性套件失败：${message}（期望错误码 ${code}，实际 ${error instanceof Error ? `${error.name}:${error.message}` : String(error)}）`,
    );
  }
  throw new Error(`一致性套件失败：${message}（期望抛出 ${code}，但成功返回）`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function freshEnv(
  factory: StoreFactory,
): Promise<ConformanceEnv & { cleanup: () => Promise<void> }> {
  const dataDir = await mkdtemp(join(tmpdir(), "data-layer-conformance-"));
  return {
    dataDir,
    factory,
    openSecondStore: () => factory({ dataDir }),
    sleep,
    cleanup: async () => rm(dataDir, { recursive: true, force: true }),
  };
}

export function createConformanceSuite(factory: StoreFactory): ConformanceCase[] {
  /** 每个用例独立：独立临时目录、独立 store 实例，跑完清理。 */
  const define = (name: string, body: (env: ConformanceEnv) => Promise<void>): ConformanceCase => ({
    name,
    run: async (env) => {
      const local = await freshEnv(factory);
      try {
        await body({ ...env, ...local, factory });
      } finally {
        await local.cleanup();
      }
    },
  });

  return [
    define("布局与版本：打开后目录、版本文件就位", async ({ dataDir, factory }) => {
      const store = await factory({ dataDir });
      try {
        for (const dir of [
          store.paths.sessions,
          store.paths.cache,
          store.paths.locks,
          store.paths.logs,
        ]) {
          const info = await stat(dir);
          assert(info.isDirectory(), `${dir} 应是目录`);
        }
        const version = JSON.parse(await readFile(store.paths.versionFile, "utf8")) as unknown;
        assertEqual(
          JSON.stringify(version),
          JSON.stringify(CURRENT_DATA_LAYER_VERSION),
          "版本文件应写入当前协议版本",
        );
        assert(
          store.version.protocolVersion === CURRENT_DATA_LAYER_VERSION.protocolVersion,
          "store.version 应与版本文件一致",
        );
        if (process.platform !== "win32") {
          const info = await stat(dataDir);
          assertEqual(info.mode & 0o077, 0, "数据层目录不应对同组/其他用户开放");
        }
      } finally {
        await store.close();
      }
    }),

    define("权限不满足：拒绝启动，不静默修正", async ({ dataDir, factory }) => {
      await chmod(dataDir, 0o755);
      await assertRejectsCode(
        () => factory({ dataDir }),
        "permission_denied",
        "目录权限过宽时应拒绝启动",
      );
      const info = await stat(dataDir);
      assertEqual(info.mode & 0o777, 0o755, "拒绝启动不得顺手改权限");
      await chmod(dataDir, 0o700);
    }),

    define("危险文件系统：拒绝启动", async ({ dataDir, factory }) => {
      await assertRejectsCode(
        () =>
          factory({
            dataDir,
            guards: { dangerousFileSystem: () => ({ dangerous: true, reason: "测试注入" }) },
          }),
        "dangerous_filesystem",
        "网络文件系统 / 云同步目录应拒绝启动",
      );
    }),

    define("版本过高：拒绝启动（不做尽力而为的解析）", async ({ dataDir, factory }) => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        join(dataDir, "version"),
        JSON.stringify({ protocolVersion: 999, minReadableVersion: 1 }),
        "utf8",
      );
      await assertRejectsCode(
        () => factory({ dataDir }),
        "protocol_version_ahead",
        "高版本数据层应拒绝启动",
      );
    }),

    define(
      "路径安全：逃逸的会话标识被拒，不存在的标识返回 undefined",
      async ({ dataDir, factory }) => {
        const store = await factory({ dataDir });
        try {
          for (const evil of ["../evil", "..", "a/b", ""]) {
            await assertRejectsCode(
              () => store.openSession(evil),
              "path_escape",
              `会话标识 ${JSON.stringify(evil)} 不得被接受`,
            );
          }
          assertEqual(
            await store.openSession("no-such-session-id"),
            undefined,
            "不存在的会话应返回 undefined",
          );
        } finally {
          await store.close();
        }
      },
    ),

    define("创建会话：header 落盘、游标从 0 开始、追加成树", async ({ dataDir, factory }) => {
      const store = await factory({ dataDir });
      try {
        const repo = await store.createSession({ cwd: dataDir });
        const header = await repo.readHeader();
        assertEqual(header.type, "session", "header 的 type 应为 session");
        assertEqual(header.version, CURRENT_SESSION_VERSION, "会话记录格式版本应沿用当前版本");
        assertEqual(header.cwd, dataDir, "header 应记录项目目录");
        assertEqual(await repo.count(), 0, "新会话不应有记录");
        assertEqual((await repo.read()).length, 0, "新会话读出为空");

        const first = await repo.append({ type: "custom", customType: "probe", data: { n: 1 } });
        assertEqual(first.seq, 1, "第一条记录的行序号应为 1（header 是第 0 行）");
        assertEqual(first.entry.parentId, null, "第一条记录的 parentId 应为 null");

        const second = await repo.append({ type: "custom", customType: "probe", data: { n: 2 } });
        assertEqual(second.seq, 2, "游标应单调递增");
        assertEqual(
          second.entry.parentId,
          first.entry.id,
          "第二条记录应指向第一条（带父指针的树）",
        );
        assertEqual(await repo.count(), 2, "记录数应与追加次数一致");

        const tail = await repo.read(1);
        assertEqual(tail.length, 1, "从游标 1 之后读应只拿到第二条");
        assertEqual(tail[0]?.entry.id, second.entry.id, "读出的应是第二条记录");
      } finally {
        await store.close();
      }
    }),

    define("追加式：内容为前缀延伸、inode 不变", async ({ dataDir, factory }) => {
      const store = await factory({ dataDir });
      try {
        const repo = await store.createSession({ cwd: dataDir });
        const snapshots: { content: string; inode: number }[] = [];
        for (let index = 0; index < 3; index += 1) {
          await repo.append({ type: "custom", customType: "probe", data: { index } });
          const info = await stat(repo.file);
          snapshots.push({ content: await readFile(repo.file, "utf8"), inode: info.ino });
        }
        for (let index = 1; index < snapshots.length; index += 1) {
          const previous = snapshots[index - 1];
          const current = snapshots[index];
          assert(previous !== undefined && current !== undefined, "快照缺失");
          assert(
            current.content.startsWith(previous.content),
            `第 ${index} 次追加不是前缀延伸：既有多会话方案的前提被破坏`,
          );
          assert(previous.content.length < current.content.length, "追加后长度应增加");
          assertEqual(current.inode, previous.inode, "追加不应改变 inode");
        }
      } finally {
        await store.close();
      }
    }),

    define(
      "非追加写必须原子：目标要么完整要么不存在，且不留临时文件",
      async ({ dataDir, factory }) => {
        const store = await factory({ dataDir });
        try {
          const payload = JSON.stringify({ big: "x".repeat(200_000), n: 1 });
          const target = "cache/atomic-probe.json";
          await store.writeAtomic(target, payload);
          assertEqual(await readFile(join(dataDir, target), "utf8"), payload, "原子写应完整落盘");

          const second = JSON.stringify({ big: "y".repeat(200_000), n: 2 });
          await store.writeAtomic(target, second);
          assertEqual(await readFile(join(dataDir, target), "utf8"), second, "覆盖写也应完整");

          const leftovers = (await readdir(join(dataDir, "cache"))).filter((name) =>
            name.includes("tmp"),
          );
          assertEqual(
            leftovers.length,
            0,
            `成功路径不得留下临时文件，实际残留：${leftovers.join(", ")}`,
          );
        } finally {
          await store.close();
        }
      },
    ),

    define("崩溃尾部：抢占时被处置（截断到最后一个换行）", async ({ dataDir, factory }) => {
      const store = await factory({ dataDir });
      let sessionId = "";
      let repoFile = "";
      try {
        const repo = await store.createSession({ cwd: dataDir });
        sessionId = repo.id;
        repoFile = repo.file;
        await repo.append({ type: "custom", customType: "probe", data: { ok: true } });
      } finally {
        await store.close();
      }

      // 模拟崩溃：文件尾部多了半行
      await appendFile(repoFile, '{"type":"custom","customType":"probe"', "utf8");

      const second = await factory({ dataDir });
      try {
        const repo = await second.openSession(sessionId);
        assert(repo !== undefined, "会话应能按 id 打开");
        // 抢占（此时没有租约，属于首次获取；实现应在接管时处置尾部）
        const lease = await second.acquireOwner(repo.id, { ttlMs: 5_000 });
        assert(lease !== undefined, "应能取得 owner");
        const repaired = await repo.repairTail();
        assert(repaired.truncatedBytes > 0, "损坏尾部应被识别并截断");
        const content = await readFile(repo.file, "utf8");
        assert(content.endsWith("\n"), "处置后文件应以换行结束");
        assertEqual(parseSessionFile(content).partialTail, "", "不应残留不完整尾部");
        assertEqual((await repo.entries()).length, 1, "只应保留那条完整记录");
        await lease.release();
      } finally {
        await second.close();
      }
    }),

    define("owner 竞争：恰好一方成功", async ({ dataDir, factory }) => {
      const first = await factory({ dataDir });
      const second = await factory({ dataDir });
      try {
        const repo = await first.createSession({ cwd: dataDir });
        const [a, b] = await Promise.all([
          first.acquireOwner(repo.id, { ttlMs: 5_000 }),
          second.acquireOwner(repo.id, { ttlMs: 5_000 }),
        ]);
        const winners = [a, b].filter((lease) => lease !== undefined);
        assertEqual(winners.length, 1, "同一会话的 owner 竞争必须恰好一方成功");
        assert(
          (await first.isOwner(repo.id)) || (await second.isOwner(repo.id)),
          "胜者应被认作 owner",
        );
        await a?.release();
        await b?.release();
      } finally {
        await first.close();
        await second.close();
      }
    }),

    define("owner 心跳超时：可被抢占，且旧租约失效", async ({ dataDir, factory }) => {
      const first = await factory({ dataDir });
      const second = await factory({ dataDir });
      try {
        const repo = await first.createSession({ cwd: dataDir });
        const lease = await first.acquireOwner(repo.id, { ttlMs: 40 });
        assert(lease !== undefined, "首次应能取得 owner");
        assertEqual(lease.isHeld(), true, "刚取得的租约应有效");

        await sleep(80);
        assertEqual(lease.isHeld(), false, "心跳超时后旧租约应失效");

        const stolen = await second.acquireOwner(repo.id, { ttlMs: 5_000 });
        assert(stolen !== undefined, "心跳超时后应可抢占");
        await assertRejectsCode(() => lease.heartbeat(), "owner_not_held", "失效租约不得再续心跳");
        await stolen.release();
      } finally {
        await first.close();
        await second.close();
      }
    }),

    define("owner 优雅释放：他人可立即接管", async ({ dataDir, factory }) => {
      const first = await factory({ dataDir });
      const second = await factory({ dataDir });
      try {
        const repo = await first.createSession({ cwd: dataDir });
        const lease = await first.acquireOwner(repo.id, { ttlMs: 5_000 });
        assert(lease !== undefined, "首次应能取得 owner");
        await lease.release();
        const next = await second.acquireOwner(repo.id, { ttlMs: 5_000 });
        assert(next !== undefined, "释放后应可立即接管");
        await next.release();
      } finally {
        await first.close();
        await second.close();
      }
    }),

    define("派生数据可丢弃：索引删除或损坏后能重建", async ({ dataDir, factory }) => {
      const store = await factory({ dataDir });
      try {
        const repo = await store.createSession({ cwd: dataDir });
        await repo.append({
          type: "message",
          message: { role: "user", content: [{ type: "text", text: "第一条消息" }] },
        });

        const before = await store.listSessions();
        assertEqual(before.length, 1, "应列出 1 个会话");
        assertEqual(before[0]?.firstMessage, "第一条消息", "索引应带首条消息");

        await rm(store.paths.cache, { recursive: true, force: true });
        const afterDelete = await store.listSessions();
        assertEqual(afterDelete.length, 1, "索引被删后应能重建");
        assertEqual(afterDelete[0]?.id, repo.id, "重建后会话标识应一致");

        await mkdir(store.paths.cache, { recursive: true });
        await writeFile(join(store.paths.cache, "sessions-index.json"), "{ 这不是 JSON", "utf8");
        const reconciled = await store.reconcileIndex();
        assertEqual(reconciled.rebuilt, true, "索引损坏应被识别并重建");
        assertEqual(reconciled.sessions.length, 1, "重建后仍应列出会话");
      } finally {
        await store.close();
      }
    }),

    define("会话目录容忍非会话文件（与基座一致）", async ({ dataDir, factory }) => {
      const store = await factory({ dataDir });
      try {
        const repo = await store.createSession({ cwd: dataDir });
        await repo.append({ type: "message", message: { role: "user", content: "hi" } });
        const bucket = dirname(repo.file);

        await mkdir(join(bucket, "subdir"), { recursive: true });
        await writeFile(join(bucket, "index.json"), "{}", "utf8");
        await writeFile(join(bucket, "x.lock"), "", "utf8");
        await writeFile(join(bucket, "bad.jsonl"), "这不是会话文件\n", "utf8");

        const sessions = await store.listSessions();
        assertEqual(sessions.length, 1, "非会话文件不应被当成会话");
        assertEqual(sessions[0]?.id, repo.id, "列出的应是那个真会话");
      } finally {
        await store.close();
      }
    }),

    define("整体替换可被检测：原地重写（inode 不变）也算（V-5）", async ({ dataDir, factory }) => {
      const store = await factory({ dataDir });
      try {
        const repo = await store.createSession({ cwd: dataDir });
        for (let index = 0; index < 3; index += 1) {
          await repo.append({ type: "custom", customType: "probe", data: { index } });
        }
        assertEqual((await repo.detectRewrite()).rewritten, false, "无变化时不应报告重写");

        const before = await readFile(repo.file, "utf8");
        const lines = before.split("\n").filter((line) => line !== "");
        const inodeBefore = (await stat(repo.file)).ino;

        // 模拟格式迁移：同一 inode 上原地重写（内容前缀断裂）
        const rewritten = `${[
          lines[0],
          JSON.stringify({
            type: "custom",
            id: "z1",
            parentId: null,
            timestamp: "2026-01-01T00:00:00.000Z",
            customType: "migrated",
          }),
        ].join("\n")}\n`;
        await writeFile(repo.file, rewritten, "utf8");
        const inodeAfter = (await stat(repo.file)).ino;
        assertEqual(inodeAfter, inodeBefore, "本用例要求原地重写（inode 不变）才具备区分力");

        const detection = await repo.detectRewrite();
        assertEqual(detection.rewritten, true, "原地重写必须被检测到（不能只靠 inode 变化）");
        assertEqual(detection.cursor, 1, "重写后游标应重新计数");
      } finally {
        await store.close();
      }
    }),
  ];
}

/** 供消费方复用的序列化工具（保证写入的字节与协议一致）。 */
export { serializeEntry };
