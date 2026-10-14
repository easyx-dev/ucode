/** platform/paths：`~` 展开、越界判定与分隔符归一（跨平台口径） */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { describe, it } from "node:test";

import { expandHome, isInsidePath, toPosixPath } from "..";

describe("expandHome", () => {
  it("只展开开头的 `~` 与 `~/`，`~user` 原样交给 realpath 报不存在", () => {
    assert.equal(expandHome("~"), homedir());
    assert.equal(expandHome("~/x/y"), join(homedir(), "x", "y"));
    assert.equal(expandHome("~user/x"), "~user/x");
    assert.equal(expandHome("/abs/~/x"), "/abs/~/x", "中段的 ~ 不是家目录");
  });

  it("Windows 习惯的 `~\\` 与 `~/` 等价", () => {
    assert.equal(expandHome("~\\x\\y"), join(homedir(), "x", "y"));
  });
});

describe("isInsidePath", () => {
  it("前缀必须落在分隔符边界上：同名兄弟目录不算在内", () => {
    const parent = join(sep, "a", "b");

    assert.equal(isInsidePath(parent, join(parent, "c")), true);
    assert.equal(isInsidePath(parent, parent), true);
    assert.equal(isInsidePath(parent, `${parent}c`), false);
  });
});

describe("toPosixPath", () => {
  it("按运行平台的分隔符归一", () => {
    assert.equal(toPosixPath(join("a", "b")), "a/b");
  });
});
