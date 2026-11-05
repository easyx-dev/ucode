/** git-tree：变更路径折成目录树（排序、计数、重名合并） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitFileChange } from "@ucode/contracts";
import { entryOf, type GitChangeEntry } from "../git-marks";
import { buildChangeTree, countFiles, marksOf } from "../git-tree";

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

  it("目录下出现过的标记去重后按展示顺序排", () => {
    const tree = buildChangeTree([
      entryOf(file("src/a.ts", "modified"), "unstaged"),
      entryOf(file("src/b.ts", "added"), "untracked"),
      entryOf(file("src/c.ts", "modified"), "staged"),
    ]);
    const src = tree.children[0];
    assert.ok(src);
    assert.deepEqual(
      marksOf(src, (entry: GitChangeEntry) =>
        entry.origin === "untracked" ? "untracked" : entry.file.status,
      ),
      ["untracked", "modified"],
    );
  });

  it("文件节点的标记是它自己那一个", () => {
    const tree = buildChangeTree([entryOf(file("a.ts", "added"), "staged")]);
    const leaf = tree.children[0];
    assert.ok(leaf);
    assert.deepEqual(
      marksOf(leaf, (entry: GitChangeEntry) => entry.file.status),
      ["added"],
    );
  });

  it("同名文件与目录共存：子模块指针条目在自己身上，内部文件在子节点里", () => {
    const tree = buildChangeTree([file("hub", "modified"), file("hub/app/x.ts", "deleted")]);
    const hub = tree.children[0];
    assert.ok(hub);
    assert.equal(hub.name, "hub");
    assert.equal(hub.file?.path, "hub", "指针变更那一条留在节点自身");
    assert.deepEqual(
      hub.children.map((node) => node.name),
      ["app"],
    );
    assert.equal(countFiles(hub), 2, "自身的指针条目与子模块内的文件都算");
    assert.deepEqual(
      marksOf(hub, (item) => item.status),
      ["modified", "deleted"],
      "目录标记汇总自身与子节点",
    );
  });
});
