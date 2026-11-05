/**
 * 子模块：识别主仓库 index 里的 gitlink、判定指针变更、把子模块内的改动并进主仓库的变更桶。
 *
 * 子模块内的条目用「主仓库相对路径」（`hub/app/x.ts`）表达——界面按仓库相对路径拼绝对路径做变更树、
 * 取 diff、给编辑器文件标记，因此不必为子模块引入第二套路径空间。
 *
 * 口径：
 * - 只覆盖 index 里注册的 gitlink；未注册的嵌套仓库按 porcelain 原样显示、不展开；
 * - 只展开 porcelain 里出现过的子模块——git 认为没有差异的就不碰（尊重用户的 `diff.ignoreSubmodules`）；
 * - 不递归嵌套子模块：子模块里的 gitlink 条目原样留下，由下一次进入那个仓库时再看；
 * - 子模块内的条目按它自己的 index 语义分桶，与 diff 的 `staged` / `worktree` 一一对应。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { GitFileChange } from "@ucode/contracts";

import { GIT_SUBMODULE_MAX } from "../../constants/tools";
import { runGit } from "./";
import { type ChangeBuckets, readChanges } from "./changes";

/** 执行 git 的落点：子模块内的文件必须在子模块仓库里比，主仓库只记得到指针 */
export type GitTarget = {
  /** 执行 git 的仓库根 */
  root: string;
  /** 该根内的相对路径；`root` 就是主仓库时即传进来的原路径 */
  path: string;
};

/** porcelain 里 gitlink 的 mode；其它 mode 都是普通文件 / 符号链接 */
const GITLINK_MODE = "160000";

/**
 * 候选前缀下被登记为 gitlink 的条目：路径 → index 里记录的 commit。
 *
 * 一次 `ls-files` 问完所有候选，比「每个变更文件各查一次」省；候选已由 `submoduleCandidates` 筛过，
 * 进到这里的基本都真是子模块，输出只有几条。
 * `--literal-pathspecs` 让 `[`、`*` 这类字符按字面处理，路径不会突然变成通配。
 */
const readGitlinks = async (
  repoRoot: string,
  candidates: readonly string[],
): Promise<Map<string, string>> => {
  const links = new Map<string, string>();
  if (candidates.length === 0) return links;

  const result = await runGit(repoRoot, [
    "--literal-pathspecs",
    "ls-files",
    "--stage",
    "-z",
    "--",
    ...candidates,
  ]);

  for (const record of result.stdout.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, commit] = record.slice(0, tab).split(" ");
    if (mode !== GITLINK_MODE || !commit) continue;
    links.set(record.slice(tab + 1), commit);
  }
  return links;
};

/**
 * 候选前缀：一条路径的每一层都可能是子模块（`hub` 是，`vendor/lib` 也是），只留下自己就有 `.git` 的那些
 * ——已初始化的子模块必定有（`.git` 是目录或文件）。
 *
 * 先过这一道同时挡掉了大头：把普通目录交给 `ls-files`，会把该目录下整份 index 列出来；
 * 而 gitlink 在 index 里只有一条，两者差着几个数量级。
 */
const submoduleCandidates = (repoRoot: string, paths: readonly string[]): string[] => {
  const candidates = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let depth = 1; depth <= segments.length; depth += 1) {
      const prefix = segments.slice(0, depth).join("/");
      if (existsSync(join(repoRoot, prefix, ".git"))) candidates.add(prefix);
    }
  }
  return [...candidates];
};

/**
 * 某个引用里记录的子模块 commit；取不到（首次提交前、该引用里没有这个路径）为 null。
 * 与 `git rev-parse` 的失败区分：失败只说明「这一侧没有」，不是错误。
 */
const commitAt = async (repoRoot: string, rev: string, path: string): Promise<string | null> => {
  const result = await runGit(repoRoot, ["rev-parse", `${rev}:${path}`]);
  return result.code === 0 ? result.stdout.trim() || null : null;
};

/** 子模块当前检出的 commit；未初始化（目录空或不存在）时无法判断，返回 null */
const submoduleHead = async (subRoot: string): Promise<string | null> => {
  if (!existsSync(join(subRoot, ".git"))) return null;
  const result = await runGit(subRoot, ["rev-parse", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() || null : null;
};

/** 四个桶里的全部变更路径 */
const allPaths = (buckets: ChangeBuckets): string[] =>
  [...buckets.staged, ...buckets.unstaged, ...buckets.untracked, ...buckets.conflicted].map(
    (file) => file.path,
  );

/** porcelain 是否把该子模块报成有变更；没报就不展开它 */
const appearsIn = (buckets: ChangeBuckets, path: string): boolean =>
  buckets.staged.some((file) => file.path === path) ||
  buckets.unstaged.some((file) => file.path === path) ||
  buckets.conflicted.some((file) => file.path === path);

/** 按主仓库的字节序重排：几个来源各自有序，拼起来不是 */
const byPath = (a: GitFileChange, b: GitFileChange): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * 把子模块内的改动并进主仓库的四个桶，并重新判定子模块自身的条目。
 *
 * 子模块自身那条（porcelain 的 `M hub`）只有在**指针**变了时才留下：只改了子模块里的文件时，
 * 那条只表示「contains modified content」，具体内容由子模块内的条目表达，留着就是重复。
 */
export const mergeSubmoduleChanges = async (
  repoRoot: string,
  buckets: ChangeBuckets,
): Promise<ChangeBuckets> => {
  const links = await readGitlinks(repoRoot, submoduleCandidates(repoRoot, allPaths(buckets)));
  if (links.size === 0) return buckets;

  const targets = [...links.keys()]
    .filter((path) => appearsIn(buckets, path))
    .slice(0, GIT_SUBMODULE_MAX);
  if (targets.length === 0) return buckets;

  const expanded = new Set(targets);
  const merged: ChangeBuckets = {
    staged: buckets.staged.filter((file) => !expanded.has(file.path)),
    unstaged: buckets.unstaged.filter((file) => !expanded.has(file.path)),
    untracked: buckets.untracked.filter((file) => !expanded.has(file.path)),
    conflicted: [...buckets.conflicted],
  };

  const submodules = await Promise.all(
    targets.map(async (path) => {
      const subRoot = join(repoRoot, path);
      const indexCommit = links.get(path) ?? null;
      const [headCommit, subHead] = await Promise.all([
        commitAt(repoRoot, "HEAD", path),
        submoduleHead(subRoot),
      ]);
      // 未初始化时既不该展开、也不知道工作区指针，整条只按 index 与 HEAD 判定
      const inner = subHead === null ? null : await readChanges(subRoot, path);
      return {
        path,
        keepStaged: indexCommit !== headCommit,
        keepUnstaged: subHead === null || subHead !== indexCommit,
        inner,
      };
    }),
  );

  for (const item of submodules) {
    if (item.keepStaged) {
      const entry = buckets.staged.find((file) => file.path === item.path);
      if (entry) merged.staged.push(entry);
    }
    if (item.keepUnstaged) {
      const entry = buckets.unstaged.find((file) => file.path === item.path);
      if (entry) merged.unstaged.push(entry);
    }
    if (item.inner) {
      merged.staged.push(...item.inner.staged);
      merged.unstaged.push(...item.inner.unstaged);
      merged.untracked.push(...item.inner.untracked);
      merged.conflicted.push(...item.inner.conflicted);
    }
  }

  return {
    staged: merged.staged.sort(byPath),
    unstaged: merged.unstaged.sort(byPath),
    untracked: merged.untracked.sort(byPath),
    conflicted: merged.conflicted.sort(byPath),
  };
};

/**
 * 把主仓库相对路径拆成「实际执行 git 的仓库根 + 该根内的路径」。
 *
 * 路径正好是子模块本身时留在主仓库——那一条看的就是指针变更（`Subproject commit` 前后）。
 * 入参须先经 `resolveRepoPath` 归一，保证不会跑出主仓库。
 */
export const resolveGitTarget = async (repoRoot: string, repoPath: string): Promise<GitTarget> => {
  const candidates = submoduleCandidates(repoRoot, [repoPath]).filter(
    (prefix) => prefix !== repoPath,
  );
  if (candidates.length === 0) return { root: repoRoot, path: repoPath };

  const links = await readGitlinks(repoRoot, candidates);
  // 候选按层级由浅到深生成，取最浅的命中的那个
  const prefix = candidates.find((candidate) => links.has(candidate));
  if (prefix === undefined) return { root: repoRoot, path: repoPath };
  return { root: join(repoRoot, prefix), path: repoPath.slice(prefix.length + 1) };
};
