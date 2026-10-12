/**
 * services/plugins/storage：安装副本的落位与清理。重点在**并发安全**——
 * 暂存根是同一个市场的多次安装共用的，任何一步都不能删别人的目录。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createPluginStorage } from "../storage";

const created: string[] = [];

const makeDir = (prefix = "plugin-storage-"): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const makeStaged = (stagingRoot: string, name: string): string => {
  const dir = join(stagingRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), "{}", "utf8");
  return dir;
};

describe("placeStaged 的暂存清理", () => {
  it("只清自己那个暂存目录：同一市场里另一个并发安装的目录必须留着", () => {
    const pluginsDir = makeDir();
    const storage = createPluginStorage({ pluginsDir });
    const stagingRoot = storage.stagingRootFor("my-market");
    const mine = makeStaged(stagingRoot, "git-aaaaaa");
    const other = makeStaged(stagingRoot, "git-bbbbbb");

    const placed = storage.placeStaged({
      staged: { path: mine, staged: true },
      marketplace: "my-market",
      name: "demo",
      version: "1.0.0",
      stagingRoot,
    });

    assert.equal(placed, join(pluginsDir, "cache", "my-market", "demo", "1.0.0"));
    assert.equal(existsSync(join(placed, "plugin.json")), true);
    assert.equal(existsSync(mine), false, "自己的暂存目录装完即清");
    assert.equal(existsSync(other), true, "别人的暂存目录不动");
  });

  it("包根是暂存目录的子目录时，清的是暂存顶层（下钻一层也不留残留）", () => {
    const pluginsDir = makeDir();
    const storage = createPluginStorage({ pluginsDir });
    const stagingRoot = storage.stagingRootFor("my-market");
    // 模拟 `repo/pkg/plugin.json`：`path` 是 staged 的子目录
    const staged = join(stagingRoot, "git-dddddd");
    const packageRoot = join(staged, "pkg");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "plugin.json"), "{}", "utf8");

    storage.placeStaged({
      staged: { path: packageRoot, staged: true, stagingDir: staged },
      marketplace: "my-market",
      name: "demo",
      version: "1.0.0",
      stagingRoot,
    });

    assert.equal(existsSync(staged), false, "暂存顶层被清掉");
    assert.equal(existsSync(stagingRoot), false, "空了就连根一起收");
    assert.equal(existsSync(join(pluginsDir, "cache", "my-market", "demo", "1.0.0")), true);
  });

  it("暂存根空了才收掉它", () => {
    const pluginsDir = makeDir();
    const storage = createPluginStorage({ pluginsDir });
    const stagingRoot = storage.stagingRootFor(undefined);
    const mine = makeStaged(stagingRoot, "url-cccccc");

    storage.placeStaged({
      staged: { path: mine, staged: true },
      marketplace: undefined,
      name: "demo",
      version: "1.0.0",
      stagingRoot,
    });

    assert.equal(existsSync(stagingRoot), false, "空了就收掉，不留空目录");
  });

  it("本地目录来源不复制，暂存目录不是它（不会误删源目录）", () => {
    const pluginsDir = makeDir();
    const source = makeDir("plugin-src-");
    const storage = createPluginStorage({ pluginsDir });

    const placed = storage.placeStaged({
      staged: { path: source, staged: false },
      marketplace: undefined,
      name: "demo",
      version: "1.0.0",
      stagingRoot: storage.stagingRootFor(undefined),
    });

    assert.equal(placed, source);
    assert.equal(existsSync(source), true, "源目录必须原地不动");
    assert.deepEqual(readdirSync(pluginsDir), [], "插件根下不该多出任何东西");
  });
});
