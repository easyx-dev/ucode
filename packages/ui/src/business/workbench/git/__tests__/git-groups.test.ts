/** git-groups：变更只分「已暂存 / 未暂存」两组，未跟踪与冲突并入未暂存 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GitFileChange, GitStatusResponse } from "@ucode/contracts";

import { countChanges, groupChanges } from "../git-groups";

const change = (
  path: string,
  status: GitFileChange["status"] = "modified",
  additions: number | null = 1,
  deletions: number | null = 0,
): GitFileChange => ({ path, status, additions, deletions });

const statusOf = (parts: Partial<GitStatusResponse>): GitStatusResponse => ({
  isRepo: true,
  repoRoot: "/repo",
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
  truncated: false,
  ...parts,
});

describe("groupChanges", () => {
  it("只出两组，已暂存在上", () => {
    const groups = groupChanges(statusOf({ staged: [change("a.ts")], unstaged: [change("b.ts")] }));
    assert.deepEqual(
      groups.map((group) => group.id),
      ["staged", "unstaged"],
    );
    assert.equal(groups[0]?.staged, true);
    assert.equal(groups[1]?.staged, false);
  });

  it("未跟踪与冲突并入未暂存，各自保留来源用于标记", () => {
    const groups = groupChanges(
      statusOf({
        unstaged: [change("tracked.ts")],
        untracked: [change("fresh.ts", "added")],
        conflicted: [change("conflict.ts", "conflicted")],
      }),
    );
    assert.equal(groups.length, 1);
    const entries = groups[0]?.entries ?? [];
    assert.deepEqual(entries.map((entry) => entry.origin).sort(), [
      "conflicted",
      "unstaged",
      "untracked",
    ]);
  });

  it("未暂存组按路径排序（三个桶拼起来后不再有序）", () => {
    const groups = groupChanges(
      statusOf({
        unstaged: [change("z.ts"), change("m.ts")],
        untracked: [change("a.ts", "added")],
      }),
    );
    assert.deepEqual(
      groups[0]?.entries.map((entry) => entry.path),
      ["a.ts", "m.ts", "z.ts"],
    );
  });

  it("条目自带 path，方便直接折树", () => {
    const groups = groupChanges(statusOf({ staged: [change("src/a.ts")] }));
    assert.equal(groups[0]?.entries[0]?.path, "src/a.ts");
  });

  it("没有改动时返回空数组", () => {
    assert.deepEqual(groupChanges(statusOf({})), []);
  });
});

describe("countChanges", () => {
  it("把全部条目的增删相加（两个分组一起算）", () => {
    const groups = groupChanges(
      statusOf({
        staged: [change("a.ts", "modified", 3, 1)],
        unstaged: [change("b.ts", "modified", 2, 4)],
      }),
    );
    assert.deepEqual(countChanges(groups.flatMap((group) => group.entries)), {
      additions: 5,
      deletions: 5,
    });
  });

  it("未跟踪文件没有行数，算 0", () => {
    const groups = groupChanges(statusOf({ untracked: [change("fresh.ts", "added", null, null)] }));
    assert.deepEqual(countChanges(groups.flatMap((group) => group.entries)), {
      additions: 0,
      deletions: 0,
    });
  });

  it("没有变更时是 0 / 0", () => {
    assert.deepEqual(countChanges([]), { additions: 0, deletions: 0 });
  });
});
