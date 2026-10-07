/** git-tree：变更路径折成目录树（排序、计数、重名合并） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitFileChange } from "@ucode/contracts";

import { buildChangeTree, countFiles } from "../git-tree";

const file = (path: string, status: GitFileChange["status"] = "modified"): GitFileChange => ({
  path,
  status,
  additions: 1,
  deletions: 0,
});

describe("buildChangeTree", () => {
  it("按 `/` 折层，目录在前、各自按名称", () => {
    // 用与大小写无关的名字，避免断言依赖 ICU 的排序口径（实现与服务端 fs/list 同为 localeCompare）
    const tree = buildChangeTree([
      file("readme.md"),
      file("src/b.ts"),
      file("src/a.ts"),
      file("docs/x/y.md"),
      file("zzz.json"),
    ]);

    assert.deepEqual(
      tree.children.map((node) => node.name),
      ["docs", "src", "readme.md", "zzz.json"],
    );
    assert.deepEqual(
      tree.children[1]?.children.map((node) => node.name),
      ["a.ts", "b.ts"],
    );
    // 深层路径逐级展开，中间节点的 path 是到它自己为止的前缀
    const docs = tree.children[0];
    const x = docs?.children[0];
    assert.equal(docs?.name, "docs");
    assert.equal(x?.name, "x");
    assert.equal(x?.path, "docs/x");
    assert.equal(x?.children[0]?.name, "y.md");
    assert.equal(x?.children[0]?.path, "docs/x/y.md");
  });

  it("同一目录下的多个文件合到同一个节点", () => {
    const tree = buildChangeTree([file("src/a.ts"), file("src/b.ts"), file("src/c/d.ts")]);
    const src = tree.children.find((node) => node.name === "src");
    assert.ok(src);
    assert.equal(countFiles(src), 3);
    // 目录在前：c/ 排在两个文件之前
    assert.deepEqual(
      src?.children.map((node) => node.name),
      ["c", "a.ts", "b.ts"],
    );
  });

  it("文件节点带原始条目，目录节点不带", () => {
    const change = file("src/a.ts", "added");
    const tree = buildChangeTree([change]);
    const leaf = tree.children[0]?.children[0];
    assert.equal(leaf?.file, change);
    assert.equal(tree.children[0]?.file, undefined);
  });

  it("空输入得到空根", () => {
    const tree = buildChangeTree([]);
    assert.deepEqual(tree.children, []);
    assert.equal(countFiles(tree), 0);
  });
});
