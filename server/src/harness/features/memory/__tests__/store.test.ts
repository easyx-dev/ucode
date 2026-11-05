/**
 * 项目记忆文件层单测：索引读写、同名覆盖、按关键词遗忘、按目录改 / 删，以及脏索引的路径防护。
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { memoryIndexPath, memoryProjectDir, projectDirName } from "../paths";
import {
  deleteFactInDir,
  forgetFacts,
  readFactInDir,
  readIndex,
  readIndexInDir,
  readIndexText,
  rememberFact,
  updateFactInDir,
} from "../store";

const root = mkdtempSync(join(tmpdir(), "memory-store-test-"));
const cwd = join(root, "project");
const appDir = join(root, "app");
const dir = memoryProjectDir(cwd, appDir);

describe("projectDirName", () => {
  it("同一路径稳定，不同路径不同", () => {
    assert.equal(projectDirName(cwd), projectDirName(cwd));
    assert.notEqual(projectDirName(cwd), projectDirName(join(root, "other")));
  });
});

describe("记忆索引与事实文件", () => {
  it("MEM-01 记住一条：写事实文件并更新索引", () => {
    const entry = rememberFact(cwd, { title: "包管理器", content: "项目统一用 pnpm。" }, appDir);
    assert.equal(entry.file, "包管理器.md");
    assert.ok(existsSync(join(dir, entry.file)), "事实文件应落盘");

    const index = readIndexText(cwd, appDir);
    assert.ok(index?.includes("[包管理器](包管理器.md)：项目统一用 pnpm。"), index ?? "(空)");
    assert.deepEqual(
      readIndex(cwd, appDir).map((item) => item.title),
      ["包管理器"],
    );
  });

  it("同名标题覆盖而非新增", () => {
    rememberFact(cwd, { title: "发布分支", content: "从 staging 发布。" }, appDir);
    rememberFact(cwd, { title: "发布分支", content: "改为从 release 发布。" }, appDir);
    const entries = readIndex(cwd, appDir).filter((item) => item.title === "发布分支");
    assert.equal(entries.length, 1);
    assert.equal(readFileSync(join(dir, entries[0]?.file ?? ""), "utf8").includes("release"), true);
  });

  it("MEM-03 忘掉一条：删文件、移除索引条目", () => {
    const deleted = forgetFacts(cwd, "发布分支", appDir);
    assert.deepEqual(
      deleted.map((item) => item.title),
      ["发布分支"],
    );
    assert.ok(!existsSync(join(dir, "发布分支.md")), "事实文件应被删除");
    assert.ok(!readIndex(cwd, appDir).some((item) => item.title === "发布分支"));
  });

  it("关键词匹配正文也能命中", () => {
    rememberFact(cwd, { title: "Node 版本", content: "站点需兼容 Node 20。" }, appDir);
    const deleted = forgetFacts(cwd, "Node 20", appDir);
    assert.deepEqual(
      deleted.map((item) => item.title),
      ["Node 版本"],
    );
  });

  it("没有条目时索引不存在，注入返回 null", () => {
    forgetFacts(cwd, "包管理器", appDir);
    assert.equal(readIndexText(cwd, appDir), null);
    assert.ok(!existsSync(memoryIndexPath(cwd, appDir)));
  });

  it("标题里的方括号与换行被折叠，不破坏索引格式", () => {
    const entry = rememberFact(
      cwd,
      { title: "配置 [prod]\n第二行", content: "部署目标。" },
      appDir,
    );
    assert.equal(entry.title, "配置 prod 第二行");
    assert.deepEqual(
      readIndex(cwd, appDir)
        .filter((item) => item.title === "配置 prod 第二行")
        .map((item) => item.file),
      [entry.file],
    );
  });

  it("脏索引里的越界文件名被忽略", () => {
    writeFileSync(
      memoryIndexPath(cwd, appDir),
      "# 项目记忆\n- [坏条目](../escaped.md)：不应被读取\n",
      "utf8",
    );
    assert.deepEqual(readIndex(cwd, appDir), []);
  });
});

describe("按记忆目录改 / 删（设置页的入口）", () => {
  /** 独立目录：与上面的用例共享 `dir` 会被前面的「忘掉」用例清掉索引 */
  const ownCwd = join(root, "project-edit");
  const ownDir = memoryProjectDir(ownCwd, appDir);

  it("改一条：文件名不变，标题与正文重写，索引行跟着改", () => {
    const created = rememberFact(ownCwd, { title: "原标题", content: "原正文" }, appDir);
    const entry = updateFactInDir(ownDir, created.file, {
      title: "新标题",
      content: "新的第一行\n第二行",
    });

    assert.deepEqual(entry, { file: created.file, title: "新标题", description: "新的第一行" });
    assert.equal(readFactInDir(ownDir, created.file), "# 新标题\n\n新的第一行\n第二行\n");
    assert.deepEqual(
      readIndexInDir(ownDir).map((item) => [item.file, item.title, item.description]),
      [[created.file, "新标题", "新的第一行"]],
    );
  });

  it("改一条：不在索引里的文件名返回 null，不新建", () => {
    assert.equal(updateFactInDir(ownDir, "不存在.md", { title: "标题", content: "正文" }), null);
    assert.equal(updateFactInDir(ownDir, "../越界.md", { title: "标题", content: "正文" }), null);
    assert.equal(existsSync(join(ownDir, "不存在.md")), false);
  });

  it("删一条：文件与索引行一起删；索引空了连索引一起删", () => {
    const entries = readIndexInDir(ownDir);
    const target = entries[0];
    assert.ok(target);

    assert.equal(deleteFactInDir(ownDir, target.file), true);
    assert.equal(existsSync(join(ownDir, target.file)), false);
    assert.deepEqual(readIndexInDir(ownDir), []);
    assert.equal(existsSync(join(ownDir, "MEMORY.md")), false);
  });

  it("删一条：已不在索引里返回 false，不误删文件", () => {
    writeFileSync(join(ownDir, "孤文件.md"), "# 孤文件\n\n正文\n", "utf8");
    assert.equal(deleteFactInDir(ownDir, "孤文件.md"), false);
    assert.equal(existsSync(join(ownDir, "孤文件.md")), true);
    assert.equal(deleteFactInDir(ownDir, "../app.db"), false);
  });
});
