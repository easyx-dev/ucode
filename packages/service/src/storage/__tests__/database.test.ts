import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, readSchemaVersion } from "../database.ts";
import { LATEST_SCHEMA_VERSION } from "../migrations.ts";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDatabasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "svc-db-"));
  created.push(dir);
  return join(dir, "nested", "service.db");
}

describe("openDatabase", () => {
  it("新建库把 schema 迁到最新版本", () => {
    const database = openDatabase(":memory:");
    expect(readSchemaVersion(database)).toBe(LATEST_SCHEMA_VERSION);
    database.close();
  });

  it("文件库落在给定路径，父目录自动建好", async () => {
    const file = await tempDatabasePath();
    const database = openDatabase(file);
    database.close();
    expect((await stat(file)).isFile()).toBe(true);
  });

  it("重复打开同一个库不重复应用迁移", async () => {
    const file = await tempDatabasePath();
    openDatabase(file).close();
    const again = openDatabase(file);
    expect(readSchemaVersion(again)).toBe(LATEST_SCHEMA_VERSION);
    again.close();
  });

  it("会话与待决交互表可用（写入后读回）", () => {
    const database = openDatabase(":memory:");
    database
      .prepare(
        "INSERT INTO sessions (id, cwd, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("s1", "/tmp/work", "首个会话", 1, 2);
    database
      .prepare(
        "INSERT INTO interactions (id, session_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("i1", "s1", "confirm", "{}", 3);

    const session = database
      .prepare("SELECT name, entry_count FROM sessions WHERE id = ?")
      .get("s1");
    expect(session).toMatchObject({ name: "首个会话", entry_count: 0 });
    const pending = database
      .prepare("SELECT COUNT(*) AS total FROM interactions WHERE resolved_at IS NULL")
      .get();
    expect(pending).toMatchObject({ total: 1 });
    database.close();
  });

  it("外键约束生效：待决交互不能挂在不存在的会话上", () => {
    const database = openDatabase(":memory:");
    expect(() =>
      database
        .prepare(
          "INSERT INTO interactions (id, session_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("i1", "missing", "confirm", "{}", 1),
    ).toThrow();
    database.close();
  });
});

describe("migrate", () => {
  it("裸库能被迁到最新版本", () => {
    const database = new DatabaseSync(":memory:");
    expect(readSchemaVersion(database)).toBe(0);
    expect(migrate(database)).toBe(LATEST_SCHEMA_VERSION);
    database.close();
  });

  it("水位已是最新时不重复执行（语句重复执行会因表已存在而报错）", () => {
    const database = new DatabaseSync(":memory:");
    migrate(database);
    expect(migrate(database)).toBe(LATEST_SCHEMA_VERSION);
    database.close();
  });
});

describe("readSchemaVersion", () => {
  it("空库的水位是 0", () => {
    const database = new DatabaseSync(":memory:");
    expect(readSchemaVersion(database)).toBe(0);
    database.close();
  });
});
