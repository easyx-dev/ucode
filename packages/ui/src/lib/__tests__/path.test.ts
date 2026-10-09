/** path：绝对路径判定、分隔符归一、路径包含关系与末段取名 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baseName, isAbsolutePath, isUnderPath, resolveFromCwd } from "../path";

describe("isAbsolutePath", () => {
  it("认 POSIX 绝对路径与 Windows 盘符 / UNC", () => {
    assert.equal(isAbsolutePath("/a/b"), true);
    assert.equal(isAbsolutePath("C:\\a\\b"), true);
    assert.equal(isAbsolutePath("\\\\server\\share"), true);
    assert.equal(isAbsolutePath("a/b"), false);
    assert.equal(isAbsolutePath("./a"), false);
  });
});

describe("resolveFromCwd", () => {
  it("相对路径拼到 cwd 下，去掉多余的 `./`", () => {
    assert.equal(resolveFromCwd("/repo", "src/a.ts"), "/repo/src/a.ts");
    assert.equal(resolveFromCwd("/repo", "./src/a.ts"), "/repo/src/a.ts");
    assert.equal(resolveFromCwd("/repo/", "src/a.ts"), "/repo/src/a.ts");
  });

  it("已经是绝对路径、没有 cwd 或空串时原样返回", () => {
    assert.equal(resolveFromCwd("/repo", "/etc/hosts"), "/etc/hosts");
    assert.equal(resolveFromCwd(null, "src/a.ts"), "src/a.ts");
    assert.equal(resolveFromCwd(undefined, "src/a.ts"), "src/a.ts");
    assert.equal(resolveFromCwd("/repo", "   "), "");
  });
});

describe("isUnderPath", () => {
  it("严格位于之下才算，自身与同前缀的兄弟目录都不算", () => {
    assert.equal(isUnderPath("/a/b/c", "/a/b"), true);
    assert.equal(isUnderPath("/a/b", "/a/b"), false);
    assert.equal(isUnderPath("/a/bc/d", "/a/b"), false);
  });

  it("分隔符无关：两端的分隔符写法与尾部斜杠都不影响结论", () => {
    assert.equal(isUnderPath("C:\\a\\b\\c", "C:\\a\\b"), true);
    assert.equal(isUnderPath("C:\\a\\bc\\d", "C:\\a\\b"), false);
    assert.equal(isUnderPath("C:\\a\\b\\c\\", "C:\\a\\b\\"), true);
  });
});

describe("baseName", () => {
  it("取最后一段，尾部分隔符忽略", () => {
    assert.equal(baseName("/work/repo"), "repo");
    assert.equal(baseName("/work/repo/"), "repo");
    assert.equal(baseName("/work//"), "work");
  });

  it("Windows 写法同样取末段", () => {
    assert.equal(baseName("C:\\work\\repo"), "repo");
    assert.equal(baseName("C:\\work\\repo\\"), "repo");
    assert.equal(baseName("C:\\"), "C:");
    assert.equal(baseName("\\\\server\\share\\proj"), "proj");
  });
});
