/** path：相对工作目录的绝对化与绝对路径判定 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAbsolutePath, resolveFromCwd } from "../path";

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
