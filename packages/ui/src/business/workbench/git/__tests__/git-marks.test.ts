/** git-marks：来源桶 → 标记，以及文件树的装饰映射（绝对路径、目录汇总） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitFileChange, GitStatusResponse } from "@ucode/contracts";

import { buildGitMarks, entryOf, markOf } from "../git-marks";

const change = (path: string, status: GitFileChange["status"] = "modified"): GitFileChange => ({
  path,
  status,
  additions: 1,
  deletions: 0,
});

const statusOf = (parts: Partial<GitStatusResponse>): GitStatusResponse => ({
  isRepo: true,
  repoRoot: "/repo",
  branch: "main",
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
  truncated: false,
  ...parts,
});

describe("markOf", () => {
  it("未跟踪单列一个标记，其余用 git 自己的状态", () => {
    assert.equal(markOf(entryOf(change("a.ts", "added"), "untracked")), "untracked");
    assert.equal(markOf(entryOf(change("a.ts", "added"), "staged")), "added");
    assert.equal(markOf(entryOf(change("a.ts", "conflicted"), "conflicted")), "conflicted");
  });
});

describe("buildGitMarks", () => {
  it("按仓库根把变更路径拼成绝对路径", () => {
    const marks = buildGitMarks(statusOf({ unstaged: [change("src/a.ts")] }));
    assert.equal(marks?.files.get("/repo/src/a.ts"), "modified");
  });

  it("仓库根带尾斜杠时也能对齐", () => {
    const marks = buildGitMarks(statusOf({ repoRoot: "/repo/", untracked: [change("b.ts")] }));
    assert.equal(marks?.files.get("/repo/b.ts"), "untracked");
  });

  it("目录集合覆盖每一级父目录", () => {
    const marks = buildGitMarks(statusOf({ unstaged: [change("src/deep/a.ts")] }));
    assert.deepEqual(
      [...(marks?.dirs.keys() ?? [])].sort(),
      ["/repo/src", "/repo/src/deep"],
      "只到仓库根为止，不含仓库根自己",
    );
  });

  it("目录取该目录下最重的标记", () => {
    const marks = buildGitMarks(
      statusOf({
        untracked: [change("src/a.ts", "added")],
        unstaged: [change("src/b.ts", "deleted")],
      }),
    );
    assert.equal(marks?.dirs.get("/repo/src"), "deleted");
  });

  it("四个桶都算进装饰（未跟踪与冲突同样着色）", () => {
    const marks = buildGitMarks(
      statusOf({
        staged: [change("a.ts", "added")],
        unstaged: [change("b.ts")],
        untracked: [change("c.ts", "added")],
        conflicted: [change("d.ts", "conflicted")],
      }),
    );
    assert.equal(marks?.files.get("/repo/c.ts"), "untracked");
    assert.equal(marks?.files.get("/repo/d.ts"), "conflicted");
    assert.equal(marks?.files.size, 4);
  });

  it("不在仓库内、没有仓库根或没有状态时都不给装饰", () => {
    assert.equal(buildGitMarks(null), null);
    assert.equal(buildGitMarks(statusOf({ isRepo: false, repoRoot: undefined })), null);
    assert.equal(buildGitMarks(statusOf({ repoRoot: undefined })), null);
  });
});
