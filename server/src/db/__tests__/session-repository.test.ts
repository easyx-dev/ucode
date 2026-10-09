/** 会话仓储单测：覆盖值、归档与列表过滤 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { openDatabase } from "../index";
import { overrideOf, SessionRepository } from "../session-repository";

/** 造一份最小可解析的会话 JSONL：header + 若干 user 消息（对账只看 header 与消息时间） */
const sessionFile = (id: string, messages: { at: number; text: string }[]): string => {
  const header = {
    type: "session",
    version: 3,
    id,
    timestamp: new Date(messages[0]?.at ?? Date.now()).toISOString(),
    cwd: "/tmp/project",
  };
  const entries = messages.map((message, index) => ({
    type: "message",
    id: `${id}-m${index}`,
    parentId: index === 0 ? null : `${id}-m${index - 1}`,
    timestamp: new Date(message.at).toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: message.text }],
      timestamp: message.at,
    },
  }));
  return `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`;
};

describe("SessionRepository", () => {
  let dir: string;
  let db: ReturnType<typeof openDatabase>;
  let repo: SessionRepository;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "session-repo-"));
    db = openDatabase(join(dir, "app.db"));
    repo = new SessionRepository(db);
  });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("未指定模式的新会话回落默认 build", () => {
    repo.create("s1", {});
    assert.equal(repo.find("s1")?.mode, "build");
  });

  it("readRunSettings 只认库里记过的值：未记过的列为 null，find 那边已回落默认值", () => {
    repo.create("s1-unset", {});
    assert.deepEqual(repo.readRunSettings("s1-unset"), { mode: null, permissionMode: null });
    assert.equal(repo.find("s1-unset")?.mode, "build");

    repo.create("s1-set", { mode: "plan", permissionMode: "full" });
    assert.deepEqual(repo.readRunSettings("s1-set"), { mode: "plan", permissionMode: "full" });

    // 只切了一个字段时另一侧仍为空：回填要能区分「没记过」与「记成了默认值」
    repo.set("s1-unset", { mode: "ask" });
    assert.deepEqual(repo.readRunSettings("s1-unset"), { mode: "ask", permissionMode: null });
  });

  it("覆盖值可写入并读回", () => {
    repo.create("s2", { mode: "ask", cwd: "/tmp" });
    const record = repo.find("s2");
    assert.equal(record?.mode, "ask");
    assert.equal(record?.cwd, "/tmp");
  });

  it("权限档位可写入并读回；非法值按未设置回落", () => {
    repo.create("s2p", { permissionMode: "full" });
    assert.equal(overrideOf(repo.find("s2p")).permissionMode, "full");
    repo.set("s2p", { permissionMode: "auto" });
    assert.equal(overrideOf(repo.find("s2p")).permissionMode, "auto");

    // 绕过写入层塞非法值，读取时按「未设置」处理
    db.prepare("UPDATE session SET permission_mode = ? WHERE id = ?").run("yolo", "s2p");
    assert.equal(overrideOf(repo.find("s2p")).permissionMode, undefined);
  });

  it("set 只覆盖显式给出的字段", () => {
    repo.create("s3", { mode: "plan" });
    repo.set("s3", { name: "改个名" });
    const record = repo.find("s3");
    assert.equal(record?.name, "改个名");
    assert.equal(record?.mode, "plan");
  });

  it("自定义模式 slug 原样保留（不再按枚举归一）", () => {
    repo.create("s4", {});
    // 绕过写入层直接塞自定义 slug，模拟自定义 primary agent 写下的模式
    db.prepare("UPDATE session SET mode = ? WHERE id = ?").run("my-agent", "s4");
    assert.equal(repo.find("s4")?.mode, "my-agent");
  });

  it("归档只写 deleted_at，行与文件都保留", () => {
    repo.create("s5", {});
    repo.archive("s5");
    const record = repo.find("s5");
    assert.ok(record?.deletedAt);
    // 归档的会话不再出现在列表里
    assert.equal(
      repo.search({ limit: 10 }).records.some((item) => item.id === "s5"),
      false,
    );
    assert.equal(repo.listIds().includes("s5"), true);
  });

  it("列表默认过滤已归档的会话", () => {
    repo.create("s6", {});
    repo.archive("s6");
    const { records, total } = repo.search({ limit: 10 });
    assert.equal(
      records.some((item) => item.id === "s6"),
      false,
    );
    assert.equal(total, records.length);
  });

  it("listCwds 给出去重后的工作目录，不含未绑定目录的会话", () => {
    repo.create("cwd-a1", { cwd: "/work/cwd-a" });
    repo.create("cwd-a2", { cwd: "/work/cwd-a" });
    repo.create("cwd-b", { cwd: "/work/cwd-b" });
    // 未绑定目录的会话 cwd 为空，不算项目目录
    repo.create("cwd-none", {});

    const cwds = repo.listCwds();
    assert.equal(cwds.filter((cwd) => cwd === "/work/cwd-a").length, 1);
    assert.ok(cwds.includes("/work/cwd-b"));
    assert.equal(
      cwds.some((cwd) => cwd.trim() === ""),
      false,
    );
  });

  it("搜索按名称与预览匹配", () => {
    repo.create("s7", { name: "写周报" });
    const { records } = repo.search({ q: "周报", limit: 10 });
    assert.equal(
      records.some((item) => item.id === "s7"),
      true,
    );
  });

  it("子会话不进主列表，按 parentSessionId 可取到", () => {
    repo.create("parent-1", {});
    repo.createChild("child-1", {
      parentId: "parent-1",
      cwd: "/tmp/project",
      mode: "build",
      agent: "explore",
      name: "侦察影响面",
    });

    const roots = repo.search({ limit: 50 }).records.map((item) => item.id);
    assert.ok(roots.includes("parent-1"));
    assert.ok(!roots.includes("child-1"), "子会话不应出现在主列表");

    const children = repo.search({ limit: 50, parentSessionId: "parent-1" }).records;
    assert.equal(children.length, 1);
    assert.equal(children[0]?.agent, "explore");
    assert.equal(children[0]?.parentSessionId, "parent-1");
    assert.equal(children[0]?.cwd, "/tmp/project");
  });

  it("discardChild 只删未落盘的行", () => {
    repo.create("dc-keep", {});
    repo.refresh("dc-keep", {
      sourcePath: "/tmp/dc-keep.jsonl",
      preview: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    repo.createChild("dc-drop", {
      parentId: "dc-keep",
      cwd: "/tmp/project",
      mode: "build",
      agent: "explore",
      name: "装配失败",
    });

    repo.discardChild("dc-drop");
    repo.discardChild("dc-keep");

    assert.equal(repo.find("dc-drop"), undefined, "未落盘的行应被删");
    assert.ok(repo.find("dc-keep"), "已落盘的行不应被删");
  });

  it("childCount 只数未归档的直接子会话", () => {
    repo.create("cc-root", {});
    repo.createChild("cc-a", {
      parentId: "cc-root",
      cwd: "/tmp/project",
      mode: "build",
      agent: "general",
      name: "a",
    });
    repo.createChild("cc-b", {
      parentId: "cc-root",
      cwd: "/tmp/project",
      mode: "build",
      agent: "explore",
      name: "b",
    });
    repo.createChild("cc-grand", {
      parentId: "cc-a",
      cwd: "/tmp/project",
      mode: "build",
      agent: "explore",
      name: "grand",
    });

    assert.equal(repo.find("cc-root")?.childCount, 2, "孙会话不计入直接子会话");
    assert.equal(repo.find("cc-a")?.childCount, 1);
    assert.equal(repo.find("cc-grand")?.childCount, 0);

    repo.archive("cc-b");
    assert.equal(repo.find("cc-root")?.childCount, 1, "已归档的子会话不计入");
  });

  it("descendantIds 收集全部子孙且不含自身", () => {
    repo.create("dd-root", {});
    repo.createChild("dd-a", {
      parentId: "dd-root",
      cwd: "/tmp/project",
      mode: "plan",
      agent: "general",
      name: "a",
    });
    repo.createChild("dd-b", {
      parentId: "dd-a",
      cwd: "/tmp/project",
      mode: "plan",
      agent: "explore",
      name: "b",
    });

    assert.deepEqual(new Set(repo.descendantIds("dd-root")), new Set(["dd-a", "dd-b"]));
    assert.equal(repo.descendantIds("dd-root").includes("dd-root"), false);
    assert.deepEqual(repo.descendantIds("dd-b"), []);
  });

  it("分叉会话是顶层会话，列表带出来源 id", () => {
    repo.create("fork-src", { name: "源会话", cwd: "/tmp/project", mode: "build" });
    repo.createForked("fork-new", {
      forkedFromId: "fork-src",
      cwd: "/tmp/project",
      name: "源会话 · 分叉",
      mode: "build",
    });

    const record = repo.find("fork-new");
    assert.equal(record?.forkedFromId, "fork-src");
    assert.equal(record?.name, "源会话 · 分叉");
    assert.equal(record?.parentSessionId, null, "分叉会话是顶层会话，不是子智能体");
    assert.equal(overrideOf(record).forkedFromId, "fork-src");
    assert.ok(
      repo.search({ limit: 50 }).records.some((item) => item.id === "fork-new"),
      "分叉会话应出现在主列表",
    );
  });

  it("级联归档父会话后子孙一起从列表消失", () => {
    repo.create("cas-root", {});
    repo.createChild("cas-child", {
      parentId: "cas-root",
      cwd: "/tmp/project",
      mode: "build",
      agent: "explore",
      name: "子会话",
    });

    // 复刻路由的级联归档：父 + descendantIds 全部写 deleted_at
    for (const id of ["cas-root", ...repo.descendantIds("cas-root")]) repo.archive(id);

    assert.equal(
      repo.search({ limit: 50 }).records.some((item) => item.id === "cas-root"),
      false,
    );
    assert.equal(repo.search({ limit: 50, parentSessionId: "cas-root" }).total, 0);
    assert.ok(repo.find("cas-child")?.deletedAt, "子会话行保留但标记为已归档");
  });

  it("置顶项排在列表最前，取消后回落", () => {
    repo.create("pin-a", {});
    repo.create("pin-b", {});
    repo.setPinned("pin-a", "2026-03-01T00:00:00.000Z");

    const ids = repo.search({ limit: 50 }).records.map((item) => item.id);
    assert.equal(ids[0], "pin-a");
    assert.equal(repo.find("pin-a")?.pinnedAt, "2026-03-01T00:00:00.000Z");
    assert.equal(overrideOf(repo.find("pin-a")).pinnedAt, "2026-03-01T00:00:00.000Z");

    repo.setPinned("pin-a", null);
    assert.equal(repo.find("pin-a")?.pinnedAt, null);
  });

  it("标记已读写 last_read_at 且不改 updated_at", () => {
    repo.create("read-1", {});
    const before = repo.find("read-1");
    repo.setLastRead("read-1", "2026-04-01T00:00:00.000Z");
    const after = repo.find("read-1");
    assert.equal(after?.lastReadAt, "2026-04-01T00:00:00.000Z");
    assert.equal(after?.updatedAt, before?.updatedAt, "标记已读不应把会话顶到列表最前");
  });

  // 对账放在最后：它会删掉「文件已消失」的行，等于清掉前面用例造的行
  it("对账时认领有文件的行，删掉文件已消失的行", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "session-files-"));
    try {
      const claimed = join(sessionsDir, "2026-01-01T00-00-00-000Z_claim-1.jsonl");
      writeFileSync(claimed, sessionFile("claim-1", [{ at: 1767225600000, text: "认领我" }]));

      repo.create("claim-1", { cwd: "/tmp/project" });
      repo.create("gone-1", {});
      assert.equal(repo.find("claim-1")?.sourcePath, null, "前置：这一行还没有文件路径");

      await repo.reconcile(sessionsDir);

      assert.equal(repo.find("claim-1")?.sourcePath, claimed);
      assert.equal(repo.find("gone-1"), undefined, "文件已消失的行应被删掉");
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it("对账时同一个 id 有多份文件取最近修改的那份", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "session-dups-"));
    try {
      const earlier = join(sessionsDir, "2026-01-01T00-00-00-000Z_dup-1.jsonl");
      const later = join(sessionsDir, "2026-01-02T00-00-00-000Z_dup-1.jsonl");
      writeFileSync(earlier, sessionFile("dup-1", [{ at: 1767225600000, text: "早的那份" }]));
      writeFileSync(later, sessionFile("dup-1", [{ at: 1767312000000, text: "晚的那份" }]));

      repo.create("dup-1", { cwd: "/tmp/project" });
      await repo.reconcile(sessionsDir);

      assert.equal(repo.find("dup-1")?.sourcePath, later);
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
