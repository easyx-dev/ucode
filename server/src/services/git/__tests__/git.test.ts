/**
 * git 底座与状态 / diff / 历史解析：在一个真实临时仓库上跑一遍。
 *
 * 这些用例依赖机器上有 git（服务本身也依赖），没有 git 时整体跳过而不是失败——
 * `git_unavailable` 是运行期错误码，不是测试环境的失败。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { ERROR_CODES } from "@ucode/contracts";
import { FS_READ_TEXT_MAX_BYTES } from "../../../constants/tools";
import { AppError } from "../../../platform/response";
import {
  findRepositoryRoot,
  isTracked,
  repositoryRootOf,
  requireRepositoryRoot,
  resolveRepoPath,
  runGit,
} from "..";
import { readDiffContents } from "../contents";
import { parseFileDiff } from "../diff";
import { readCommit, readLog } from "../log";
import { readRepositoryStatus } from "../status";
import { resolveGitTarget } from "../submodules";

const hasGit = (): boolean => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const GIT_AVAILABLE = hasGit();

describe("git 底座与解析", { skip: !GIT_AVAILABLE }, () => {
  let repo: string;

  const git = (...args: string[]): string =>
    execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: repo, encoding: "utf8" });

  before(() => {
    // 临时目录在 macOS 上落在 `/var` 符号链下，服务端一律报 realpath，测试也跟着归一
    repo = realpathSync(mkdtempSync(join(tmpdir(), "git-test-")));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "Tester");
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    mkdirSync(join(repo, "sub"));
    writeFileSync(join(repo, "sub", "b.txt"), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "首次提交");
  });

  after(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("向上找到仓库根，不在仓库内的目录返回 null", () => {
    assert.equal(findRepositoryRoot(join(repo, "sub")), repo);
    assert.equal(repositoryRootOf(join(repo, "sub")), repo);
    assert.equal(repositoryRootOf(tmpdir()), null);
    assert.equal(requireRepositoryRoot(join(repo, "sub")), repo);
  });

  it("相对路径归一化：接受 `./x` 与反斜杠，拒绝绝对路径与上跳", () => {
    assert.equal(resolveRepoPath(repo, "./sub/b.txt"), "sub/b.txt");
    assert.equal(resolveRepoPath(repo, "sub\\b.txt"), "sub/b.txt");
    assert.throws(() => resolveRepoPath(repo, "/etc/passwd"), /不是仓库内路径/);
    assert.throws(() => resolveRepoPath(repo, "../../etc/passwd"), /路径超出仓库范围/);
  });

  it("状态：分组变更 / 未跟踪 / 冲突，并带上分支与行数", async (t) => {
    // 这组改动会弄脏仓库，无论断言是否成立都要复原，否则后续用例会看到残留的暂存区
    t.after(() => {
      rmSync(join(repo, "fresh.txt"), { force: true });
      rmSync(join(repo, "staged.txt"), { force: true });
      git("reset", "-q");
      git("checkout", "--", ".");
      git("clean", "-qfd");
    });

    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
    writeFileSync(join(repo, "staged.txt"), "s\n");
    git("add", "staged.txt");
    writeFileSync(join(repo, "fresh.txt"), "new\n");

    const status = await readRepositoryStatus(repo);
    assert.equal(status.isRepo, true);
    assert.equal(status.repoRoot, repo);
    assert.equal(status.branch, "main");

    const unstaged = status.unstaged.find((file) => file.path === "a.txt");
    assert.equal(unstaged?.status, "modified");
    assert.deepEqual([unstaged?.additions, unstaged?.deletions], [1, 0], "工作区改动带 +1/-0");

    const staged = status.staged.find((file) => file.path === "staged.txt");
    assert.equal(staged?.status, "added");
    assert.deepEqual([staged?.additions, staged?.deletions], [1, 0]);

    const untracked = status.untracked.find((file) => file.path === "fresh.txt");
    assert.equal(untracked?.status, "added");
    assert.deepEqual(
      [untracked?.additions, untracked?.deletions],
      [null, null],
      "未跟踪的条目没有行数统计",
    );
  });

  it("状态：分离头指针报空分支，还没有提交的仓库则整项缺省", async (t) => {
    t.after(() => git("checkout", "-q", "main"));
    // 分离头指针时 `rev-parse --abbrev-ref HEAD` 报的是 `HEAD`，契约要求空串
    git("checkout", "-q", "--detach");
    assert.equal((await readRepositoryStatus(repo)).branch, "");

    const unborn = realpathSync(mkdtempSync(join(tmpdir(), "git-unborn-")));
    t.after(() => rmSync(unborn, { recursive: true, force: true }));
    execFileSync("git", ["init", "-q"], { cwd: unborn });
    const empty = await readRepositoryStatus(unborn);
    assert.equal(empty.isRepo, true);
    assert.equal(empty.branch, undefined, "HEAD 不存在时整项缺省，不报成分离头指针");
  });

  it("diff：解析 hunk、行号与增删计数", () => {
    const raw = [
      "diff --git a/a.txt b/a.txt",
      "index 1111111..2222222 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      "+three",
      "",
    ].join("\n");

    const diff = parseFileDiff("a.txt", raw);
    assert.equal(diff.status, "modified");
    assert.equal(diff.binary, false);
    assert.deepEqual([diff.additions, diff.deletions], [2, 1]);
    assert.equal(diff.hunks.length, 1);
    assert.deepEqual(diff.hunks[0]?.lines, [
      { kind: "ctx", oldLine: 1, newLine: 1, text: "one" },
      { kind: "del", oldLine: 2, newLine: null, text: "two" },
      { kind: "add", oldLine: null, newLine: 2, text: "TWO" },
      { kind: "add", oldLine: null, newLine: 3, text: "three" },
    ]);
  });

  it("diff：二进制与「无行尾换行」标记", () => {
    const binary = parseFileDiff(
      "x.bin",
      "diff --git a/x.bin b/x.bin\nBinary files a/x.bin and b/x.bin differ\n",
    );
    assert.equal(binary.binary, true);
    assert.equal(binary.hunks.length, 0);

    const noNewline = parseFileDiff(
      "a.txt",
      ["@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new", ""].join("\n"),
    );
    assert.equal(noNewline.hunks[0]?.lines.length, 2, "标记行不算内容行");
  });

  it("日志与单次提交：字段切分不被标题里的分隔符影响", async () => {
    git("commit", "-q", "--allow-empty", "-m", "带\t制表符的标题");
    const log = await readLog(repo, 10, 0);
    assert.equal(log.commits[0]?.subject, "带\t制表符的标题", "标题原样保留");
    assert.ok(log.commits[0]?.shortHash);
    assert.equal(log.hasMore, false);

    const limited = await readLog(repo, 1, 0);
    assert.equal(limited.commits.length, 1);
    assert.equal(limited.hasMore, true);

    const hash = log.commits[0]?.hash ?? "";
    const show = await readCommit(repo, hash);
    assert.equal(show.commit.hash, hash);
    assert.deepEqual(show.commit.parents.length, 1);
    assert.equal(show.files.length, 0, "空提交没有改动文件");
  });

  it("isTracked 区分未跟踪与已跟踪（含已删除但仍在 index 的）", async () => {
    writeFileSync(join(repo, "tracked.txt"), "x\n");
    git("add", "tracked.txt");
    writeFileSync(join(repo, "untracked.txt"), "y\n");

    assert.equal(await isTracked(repo, "tracked.txt"), true);
    assert.equal(await isTracked(repo, "untracked.txt"), false);
    assert.equal(await isTracked(repo, "never-existed.txt"), false);

    rmSync(join(repo, "untracked.txt"), { force: true });
    git("reset", "-q");
    git("clean", "-qfd");
  });

  it("提交详情保留重命名状态与原路径", async () => {
    writeFileSync(join(repo, "before.txt"), "a\nb\n");
    git("add", "-A");
    git("commit", "-q", "-m", "准备重命名");

    git("mv", "before.txt", "after.txt");
    git("commit", "-q", "-m", "重命名");
    const log = await readLog(repo, 1, 0);
    const show = await readCommit(repo, log.commits[0]?.hash ?? "");

    assert.deepEqual(
      show.files.map((file) => [file.path, file.status, file.oldPath]),
      [["after.txt", "renamed", "before.txt"]],
    );
  });

  it("单次提交的改动文件列表带状态", async () => {
    writeFileSync(join(repo, "sub", "b.txt"), "x\ny\n");
    git("add", "-A");
    git("commit", "-q", "-m", "扩一行");
    const log = await readLog(repo, 1, 0);
    const show = await readCommit(repo, log.commits[0]?.hash ?? "");
    assert.deepEqual(
      show.files.map((file) => [file.path, file.status]),
      [["sub/b.txt", "modified"]],
    );
  });

  it("contents：工作区 / 已暂存 / 提交三种来源都给对比两侧的原文", async (t) => {
    t.after(() => {
      rmSync(join(repo, "newfile.txt"), { force: true });
      git("reset", "-q");
      git("checkout", "--", ".");
      git("clean", "-qfd");
    });

    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
    const worktree = await readDiffContents(repo, {
      path: repo,
      file: "a.txt",
      source: "worktree",
    });
    assert.equal(worktree.old?.text, "one\ntwo\n", "工作区的基准是 index");
    assert.equal(worktree.new?.text, "one\ntwo\nthree\n");

    writeFileSync(join(repo, "newfile.txt"), "s\n");
    git("add", "newfile.txt");
    const staged = await readDiffContents(repo, {
      path: repo,
      file: "newfile.txt",
      source: "staged",
    });
    assert.equal(staged.old, undefined, "新增文件在 HEAD 里没有旧侧");
    assert.equal(staged.new?.text, "s\n", "已暂存的基准是 HEAD、目标是 index");

    const head = git("rev-parse", "HEAD").trim();
    const committed = await readDiffContents(repo, {
      path: repo,
      file: "a.txt",
      source: "commit",
      commit: head,
    });
    assert.equal(committed.new?.text, "one\ntwo\n");
    assert.equal(committed.old?.text, "one\ntwo\n");
  });

  it("contents：未跟踪文件只有工作区一侧，二进制只给标志", async (t) => {
    t.after(() => {
      rmSync(join(repo, "fresh.txt"), { force: true });
      rmSync(join(repo, "blob.bin"), { force: true });
    });

    writeFileSync(join(repo, "fresh.txt"), "new\n");
    const untracked = await readDiffContents(repo, {
      path: repo,
      file: "fresh.txt",
      source: "worktree",
    });
    assert.equal(untracked.old, undefined, "未跟踪文件在 index 里没有条目");
    assert.equal(untracked.new?.text, "new\n");

    writeFileSync(join(repo, "blob.bin"), Buffer.from([0x00, 0x01, 0x02]));
    const binary = await readDiffContents(repo, {
      path: repo,
      file: "blob.bin",
      source: "worktree",
    });
    assert.equal(binary.new?.binary, true);
    assert.equal(binary.new?.text, undefined, "二进制不给文本");
  });

  it("contents：超出内联上限的文本只标 truncated", async (t) => {
    const big = join(repo, "big.txt");
    writeFileSync(big, "a".repeat(FS_READ_TEXT_MAX_BYTES + 10));
    t.after(() => rmSync(big, { force: true }));

    const contents = await readDiffContents(repo, {
      path: repo,
      file: "big.txt",
      source: "worktree",
    });
    assert.equal(contents.new?.truncated, true);
  });

  it("contents：0 字节的文件给空文本，不算这一侧缺失", async (t) => {
    writeFileSync(join(repo, "empty.txt"), "");
    git("add", "empty.txt");
    t.after(() => {
      rmSync(join(repo, "empty.txt"), { force: true });
      git("reset", "-q");
    });

    const staged = await readDiffContents(repo, {
      path: repo,
      file: "empty.txt",
      source: "staged",
    });
    assert.equal(staged.old, undefined, "HEAD 里没有这个文件");
    assert.equal(staged.new?.text, "");
    assert.equal(staged.new?.binary, false);
  });

  it("contents：source 为 commit 缺 hash 时按非法请求拒绝", async () => {
    await assert.rejects(
      () => readDiffContents(repo, { path: repo, file: "a.txt", source: "commit" }),
      (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.invalidRequest,
    );
  });
});

/**
 * 子模块：在临时目录里真挂一个本地子模块（不走网络），验两件事——子模块内的改动按主仓库相对路径
 * 进列表、子模块内文件的 diff 与两侧原文要在子模块仓库里取。
 */
describe("git 子模块", { skip: !GIT_AVAILABLE }, () => {
  let root: string;
  let parent: string;
  let submodule: string;

  // 挂子模块时 git 会把 `Cloning into ...` 写到 stderr，这里收起来，测试输出只留结论
  const gitAt = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "core.quotepath=false", "-c", "core.autocrlf=false", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  /** 自动换行会让「index 里的 LF」与「检出的 CRLF」看起来整文件都改了，只在这里归一 */
  const normalize = (text: string | undefined): string | undefined => text?.replace(/\r\n/g, "\n");

  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "git-submodule-test-")));
    const source = join(root, "upstream");
    parent = join(root, "parent");

    // 被挂成子模块的仓库
    mkdirSync(source);
    gitAt(source, "init", "-q", "-b", "main");
    gitAt(source, "config", "user.email", "t@example.com");
    gitAt(source, "config", "user.name", "Tester");
    writeFileSync(join(source, "a.txt"), "one\n");
    gitAt(source, "add", "-A");
    gitAt(source, "commit", "-q", "-m", "子模块首次提交");

    // 父仓库：先有自己的提交，再用本地路径挂上子模块（file 协议要显式放行）
    mkdirSync(parent);
    gitAt(parent, "init", "-q", "-b", "main");
    gitAt(parent, "config", "user.email", "t@example.com");
    gitAt(parent, "config", "user.name", "Tester");
    writeFileSync(join(parent, "readme.md"), "parent\n");
    gitAt(parent, "add", "readme.md");
    gitAt(parent, "commit", "-q", "-m", "父仓库首次提交");
    gitAt(
      parent,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      pathToFileURL(source).href,
      "vendored",
    );
    gitAt(parent, "commit", "-q", "-m", "挂上子模块");
    submodule = join(parent, "vendored");

    // 再挂一个到多级路径下：子模块不一定挂在第一层
    gitAt(
      parent,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      pathToFileURL(source).href,
      "vendor/lib",
    );
    gitAt(parent, "commit", "-q", "-m", "挂上多级路径的子模块");
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("子模块内的改动按主仓库相对路径列出，指针变更单独成条", async () => {
    // 只改子模块里的文件：那一条是「contains modified content」，不该再占一个 vendored
    writeFileSync(join(submodule, "a.txt"), "one\ntwo\n");
    const dirty = await readRepositoryStatus(parent);
    assert.deepEqual(
      dirty.unstaged.map((file) => file.path),
      ["vendored/a.txt"],
      "行列数算在子模块那个文件上，不额外冒出 vendored",
    );
    assert.equal(dirty.unstaged[0]?.status, "modified");
    assert.deepEqual([dirty.unstaged[0]?.additions, dirty.unstaged[0]?.deletions], [1, 0]);

    // 在子模块里暂存：按子模块自己的 index 语义进「已暂存」
    gitAt(submodule, "add", "a.txt");
    const staged = await readRepositoryStatus(parent);
    assert.deepEqual(
      staged.staged.map((file) => file.path),
      ["vendored/a.txt"],
    );
    assert.equal(staged.unstaged.length, 0);

    // 在子模块里提交：变成指针变更，子模块内也不再有自己的条目
    gitAt(submodule, "commit", "-q", "-m", "子模块里提交");
    const pointer = await readRepositoryStatus(parent);
    assert.deepEqual(
      pointer.unstaged.map((file) => file.path),
      ["vendored"],
    );
    assert.equal(pointer.unstaged[0]?.status, "modified");
    // 指针那一行的变化被 git 自己算成 +1/-1，与 `git diff` 的输出保持一致
    assert.deepEqual([pointer.unstaged[0]?.additions, pointer.unstaged[0]?.deletions], [1, 1]);
    assert.equal(pointer.staged.length, 0);
  });

  it("子模块内的未跟踪文件也列出来", async (t) => {
    writeFileSync(join(submodule, "new.txt"), "n\n");
    t.after(() => rmSync(join(submodule, "new.txt"), { force: true }));

    const status = await readRepositoryStatus(parent);
    assert.ok(
      status.untracked.some((file) => file.path === "vendored/new.txt"),
      status.untracked.map((file) => file.path).join(","),
    );
  });

  it("子模块内的路径放到子模块仓库里执行，子模块本身留在主仓库", async () => {
    const inner = await resolveGitTarget(parent, "vendored/a.txt");
    assert.equal(inner.root, submodule);
    assert.equal(inner.path, "a.txt");

    // 指针变更那一条看的是主仓库里的 gitlink，不能进子模块
    const pointer = await resolveGitTarget(parent, "vendored");
    assert.equal(pointer.root, parent);
    assert.equal(pointer.path, "vendored");

    const own = await resolveGitTarget(parent, "readme.md");
    assert.equal(own.root, parent);
    assert.equal(own.path, "readme.md");
  });

  it("子模块内的两侧原文取自子模块仓库，回给客户端的仍是主仓库相对路径", async (t) => {
    // 基线固定在子模块自己的 index 上：index 一行、工作区两行
    writeFileSync(join(submodule, "a.txt"), "one\n");
    gitAt(submodule, "add", "a.txt");
    writeFileSync(join(submodule, "a.txt"), "one\ntwo\n");
    t.after(() => {
      gitAt(submodule, "reset", "-q");
      gitAt(submodule, "checkout", "--", "a.txt");
    });

    const contents = await readDiffContents(parent, {
      path: parent,
      file: "vendored/a.txt",
      source: "worktree",
    });
    assert.equal(contents.path, "vendored/a.txt");
    assert.equal(normalize(contents.old?.text), "one\n", "基准侧是子模块的 index");
    assert.equal(normalize(contents.new?.text), "one\ntwo\n");
  });

  it("子模块挂在多级路径下时也能定位与列出", async (t) => {
    writeFileSync(join(parent, "vendor", "lib", "a.txt"), "one\ntwo\n");
    t.after(() => gitAt(join(parent, "vendor", "lib"), "checkout", "--", "a.txt"));

    const status = await readRepositoryStatus(parent);
    assert.ok(
      status.unstaged.some((file) => file.path === "vendor/lib/a.txt"),
      status.unstaged.map((file) => file.path).join(","),
    );
    assert.equal(
      status.unstaged.some((file) => file.path === "vendor/lib"),
      false,
      "只是脏的时候不额外占一条指针条目",
    );

    const inner = await resolveGitTarget(parent, "vendor/lib/a.txt");
    assert.equal(inner.root, join(parent, "vendor", "lib"));
    assert.equal(inner.path, "a.txt");

    // 指针变更那一条仍在主仓库，与单层子模块同一口径
    const pointer = await resolveGitTarget(parent, "vendor/lib");
    assert.equal(pointer.root, parent);
    assert.equal(pointer.path, "vendor/lib");
  });
});

/**
 * 未装 git 时的口径：不依赖机器上有 git，反而要把它从 PATH 里藏起来。
 * execa 的 `reject: false` 会把「命令不存在」也落成 result，判定错就会退化成 `git_failed`。
 */
describe("git 底座 · 找不到 git", () => {
  it("报 git_unavailable 而不是 git_failed", async (t) => {
    // Windows 上清空 PATH 不足以让 spawn 找不到 git（还会在应用目录等位置搜索）
    if (process.platform === "win32") {
      t.skip("Windows 的 spawn 搜索路径不只依赖 PATH");
      return;
    }
    const originalPath = process.env.PATH;
    process.env.PATH = join(tmpdir(), "no-git-bin");
    try {
      await assert.rejects(
        () => runGit(tmpdir(), ["status", "--porcelain"]),
        (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.gitUnavailable,
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
