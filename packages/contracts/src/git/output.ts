/** git 域的响应模型：变更条目、结构化 diff、提交摘要与提交详情 */
import type { GitDiffLineKind, GitFileStatus } from "../constants";

/**
 * 一个变更文件。`path` 相对仓库根且为 POSIX 分隔符（与 git 输出同口径），
 * 客户端拿仓库根拼接绝对路径；重命名 / 复制时原路径在 `oldPath`。
 */
export type GitFileChange = {
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  /** 新增行数；未跟踪、重命名与二进制文件无法统计时为 null */
  additions: number | null;
  /** 删除行数；无法统计时为 null */
  deletions: number | null;
};

export type GitStatusResponse = {
  /** 目标目录是否在 git 仓库内；false 时其余字段缺省 */
  isRepo: boolean;
  /** 仓库根绝对路径 */
  repoRoot?: string;
  /** 当前分支名；分离头指针时为空字符串 */
  branch?: string;
  /** 上游跟踪分支（如 `origin/main`），未设置时缺省 */
  upstream?: string;
  /** 相对上游领先 / 落后的提交数；无上游时缺省 */
  ahead?: number;
  behind?: number;
  /** index 相对 HEAD 的改动 */
  staged: GitFileChange[];
  /** 工作区相对 index 的改动 */
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  /** 存在合并冲突的文件（porcelain 的未合并状态） */
  conflicted: GitFileChange[];
  /** 是否因条数上限被截断 */
  truncated: boolean;
};

/** diff 的一行；`oldLine` / `newLine` 为该行在两侧的行号（新增 / 删除各缺一侧） */
export type GitDiffLine = {
  kind: GitDiffLineKind;
  oldLine: number | null;
  newLine: number | null;
  /** 行内容（不含前导的 +/-/空格） */
  text: string;
};

/** 一个 hunk；`header` 保留 git 的原文（`@@ -a,b +c,d @@` 及尾部函数上下文） */
export type GitHunk = {
  header: string;
  lines: GitDiffLine[];
};

/**
 * 单个文件的 diff。`binary` 为真时没有 hunk（git 不展开二进制差异）；
 * `truncated` 表示因行数上限被截断。
 */
export type GitFileDiff = {
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: GitHunk[];
  truncated: boolean;
};

export type GitDiffResponse = GitFileDiff;

export type GitCommitSummary = {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  /** 提交时刻（ISO 8601，带提交本身的时区偏移） */
  authoredAt: string;
  /** 指向该提交的分支 / 标签装饰；无则空数组 */
  refs: string[];
};

export type GitLogResponse = {
  commits: GitCommitSummary[];
  /** 是否还有更早的提交（按 `limit` 判定） */
  hasMore: boolean;
};

export type GitCommitDetail = GitCommitSummary & {
  /** 提交正文（不含标题行）；无正文时为空字符串 */
  body: string;
  /** 父提交 hash；首次提交为空数组，合并提交有多项 */
  parents: string[];
};

export type GitShowResponse = {
  commit: GitCommitDetail;
  /** 该提交改动的文件；单个文件的 diff 由客户端按需取 */
  files: GitFileChange[];
  /** 文件列表是否因条数上限被截断 */
  truncated: boolean;
};
