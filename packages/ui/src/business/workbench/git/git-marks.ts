/**
 * git 变更的展示标记：字母与色调的唯一口径，以及文件树的装饰数据。
 *
 * 服务端把未跟踪的条目也报成 `added`（porcelain 的 `??`）——两者都是「新增」，但未跟踪还没进 index，
 * 界面必须分开，因此在状态之上补一个 `untracked` 标记。冲突沿用服务端自己的 `conflicted`。
 * 颜色只表达状态，取自语义 token，不新增色相。
 */
import type { GitFileChange, GitFileStatus, GitStatusResponse } from "@ucode/contracts";

import { dirName, isUnderPath, joinPath } from "../../../utils/path";

/** 变更来自哪个桶：状态不够用时（未跟踪 vs 已暂存的新增）由它区分 */
export type GitChangeOrigin = "staged" | "unstaged" | "untracked" | "conflicted";

/** 界面标记：服务端状态 + 未跟踪 */
export type GitMark = GitFileStatus | "untracked";

/** 一个变更条目：文件本身 + 它来自哪个桶；`path` 与 `file.path` 同值，便于直接按路径折树 */
export type GitChangeEntry = { path: string; file: GitFileChange; origin: GitChangeOrigin };

export const entryOf = (file: GitFileChange, origin: GitChangeOrigin): GitChangeEntry => ({
  path: file.path,
  file,
  origin,
});

/** 同一处要列多个标记时的顺序：还没进 index 的排前面 */
export const GIT_MARK_ORDER: readonly GitMark[] = [
  "untracked",
  "conflicted",
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typeChanged",
];

/** 标记 → 字母；与 git 自己的惯例一致（未跟踪是 U，冲突是 !，与删除的 D 区分开） */
const LETTER: Record<GitMark, string> = {
  untracked: "U",
  conflicted: "!",
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typeChanged: "T",
};

const TONE: Record<GitMark, string> = {
  untracked: "text-success",
  conflicted: "text-destructive",
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
  renamed: "text-info",
  copied: "text-info",
  typeChanged: "text-foreground-subtle",
};

export const markLetter = (mark: GitMark): string => LETTER[mark];

export const markTone = (mark: GitMark): string => TONE[mark];

/**
 * 目录着色的取重顺序：目录汇总时取其中最重的一个变更。
 * 与 VSCode 的行为一致——目录只给一个颜色，满屏密密麻麻的标记反而看不出重点。
 */
const SEVERITY: Record<GitMark, number> = {
  untracked: 1,
  added: 1,
  copied: 1,
  renamed: 1,
  modified: 2,
  typeChanged: 2,
  deleted: 3,
  conflicted: 4,
};

const worseOf = (current: GitMark | undefined, next: GitMark): GitMark =>
  current === undefined || SEVERITY[next] > SEVERITY[current] ? next : current;

/** 条目 → 标记 */
export const markOf = (entry: GitChangeEntry): GitMark =>
  entry.origin === "untracked" ? "untracked" : entry.file.status;

/** 四个桶里的条目，按「已暂存 → 工作区 → 未跟踪 → 冲突」的顺序拼起来 */
export const entriesOf = (status: GitStatusResponse): GitChangeEntry[] => [
  ...status.staged.map((file) => entryOf(file, "staged")),
  ...status.unstaged.map((file) => entryOf(file, "unstaged")),
  ...status.untracked.map((file) => entryOf(file, "untracked")),
  ...status.conflicted.map((file) => entryOf(file, "conflicted")),
];

/** 文件树的装饰数据：绝对路径 → 标记，以及有变更的目录 */
export type GitMarks = {
  /** 有变更的文件（绝对路径 → 标记）；已删除的文件不在文件树里，会自然落空 */
  files: ReadonlyMap<string, GitMark>;
  /** 其下有变更的目录及其汇总标记；文件树逐层懒加载，目录行据此着色 */
  dirs: ReadonlyMap<string, GitMark>;
};

/**
 * 变更状态 → 文件树装饰。
 *
 * 变更路径是仓库相对路径，先按仓库根拼成绝对路径，才好在文件树里按节点命中；
 * 目录集合逐级上溯生成（汇总标记取该目录下最重的一个）——文件树一次只加载一层，
 * 没法自下而上判断某个目录有没有变更。
 */
export const buildGitMarks = (status: GitStatusResponse | null): GitMarks | null => {
  if (!status?.isRepo || !status.repoRoot) return null;
  const root = status.repoRoot.replace(/\/+$/, "");
  const files = new Map<string, GitMark>();
  const dirs = new Map<string, GitMark>();

  for (const entry of entriesOf(status)) {
    const absolute = joinPath(root, entry.file.path);
    const mark = markOf(entry);
    files.set(absolute, mark);
    for (let dir = dirName(absolute); isUnderPath(dir, root); dir = dirName(dir)) {
      dirs.set(dir, worseOf(dirs.get(dir), mark));
    }
  }

  return { files, dirs };
};
