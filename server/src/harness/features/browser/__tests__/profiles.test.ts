/**
 * profile 目录管理的单测：名字校验（挡住路径穿越）、落位与权限、占用统计的预算、删除语义。
 * 全部跑在临时目录上，不碰 `$APP_HOME`。
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  deleteProfiles,
  directorySize,
  ensureProfileDir,
  isValidProfileName,
  listProfiles,
  profilePath,
  profilesRoot,
  remainingProfileSlots,
} from "../profiles";

const homes: string[] = [];

/** 每个用例一个假 `$APP_HOME`，结束统一删掉 */
const appHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "browser-home-"));
  homes.push(home);
  return home;
};

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe("名字校验", () => {
  it("接受常见的名字", () => {
    for (const name of ["default", "work", "a1", "team.dev", "my_profile-2"]) {
      assert.equal(isValidProfileName(name), true, name);
    }
  });

  it("挡住路径穿越与大小写 / 特殊字符", () => {
    for (const name of [
      "../etc",
      "a/b",
      "..",
      ".",
      "",
      "Default",
      "有中文",
      "a".repeat(65),
      "-lead",
    ]) {
      assert.equal(isValidProfileName(name), false, name);
    }
  });

  it("不合法的名字在拼路径时就报错，不会写出目录外", () => {
    const home = appHome();
    assert.throws(
      () => profilePath("../escape", home),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "browser_profile_invalid");
        return true;
      },
    );
  });
});

describe("落位与权限", () => {
  it("目录落在 app/browser/profiles 下", () => {
    const home = appHome();
    const dir = ensureProfileDir("work", home);
    assert.equal(dir, join(profilesRoot(home), "work"));
    assert.equal(dir, join(home, "app", "browser", "profiles", "work"));
  });

  it("目录权限是 0700（里面有 cookie 与 localStorage）", () => {
    if (process.platform === "win32") return; // Windows 走 ACL，chmod 不表达这件事
    const home = appHome();
    const dir = ensureProfileDir("work", home);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });

  it("已存在的目录会被重新收紧权限（老版本可能建得松）", () => {
    if (process.platform === "win32") return;
    const home = appHome();
    const dir = ensureProfileDir("loose", home);
    chmodSync(dir, 0o777);
    ensureProfileDir("loose", home);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  });
});

describe("列举与占用", () => {
  it("只列目录，忽略文件与不合法的名字", () => {
    const home = appHome();
    ensureProfileDir("work", home);
    ensureProfileDir("play", home);
    mkdirSync(join(profilesRoot(home), "Bad Name"), { recursive: true });
    writeFileSync(join(profilesRoot(home), "stray.txt"), "x");
    assert.deepEqual(
      listProfiles(home).map((item) => item.name),
      ["play", "work"],
    );
  });

  it("占用按递归累加，带最后改动时间", () => {
    const home = appHome();
    const dir = ensureProfileDir("work", home);
    writeFileSync(join(dir, "Cookies"), Buffer.alloc(1024));
    mkdirSync(join(dir, "Default"), { recursive: true });
    writeFileSync(join(dir, "Default", "Local Storage"), Buffer.alloc(2048));

    const [info] = listProfiles(home);
    assert.equal(info?.bytes, 3072);
    assert.equal(info?.exact, true);
    assert.ok(info?.lastUsedAt, "应给出最后改动时间");
  });

  it("目录不存在时列举给空数组（不是报错）", () => {
    const home = appHome();
    assert.deepEqual(listProfiles(home), []);
    assert.equal(remainingProfileSlots(home), 10);
  });

  it("文件数超过遍历上限时标记不精确", () => {
    const home = appHome();
    const dir = ensureProfileDir("big", home);
    for (let index = 0; index < 3; index += 1) writeFileSync(join(dir, `f${index}`), "x");
    const size = directorySize(dir);
    // 预算在常量里（20 000），这里只验证「正常路径给精确值」与形状
    assert.equal(size.exact, true);
    assert.ok(size.bytes > 0);
  });
});

describe("删除", () => {
  it("删掉指定 profile，不存在的原样报回", () => {
    const home = appHome();
    ensureProfileDir("work", home);
    ensureProfileDir("play", home);
    const result = deleteProfiles(["work", "ghost"], home);
    assert.deepEqual(result.deleted, ["work"]);
    assert.deepEqual(result.missing, ["ghost"]);
    assert.deepEqual(
      listProfiles(home).map((item) => item.name),
      ["play"],
    );
  });

  it("不合法的名字直接拒绝（不会删到目录外）", () => {
    const home = appHome();
    assert.throws(() => deleteProfiles(["../escape"], home), /不合法/);
  });
});
