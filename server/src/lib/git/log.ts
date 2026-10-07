/**
 * 提交历史与单次提交：`git log` 的精简摘要、单次提交的元信息与改动文件列表。
 *
 * 输出统一用「NUL 分隔记录、记录内 ASCII 单元分隔符（U+001F）分字段」的格式解析：
 * 提交标题里可能出现任意字符（含制表符与换行），用不可见控制符分字段比 `\t` 稳妥。
 */
import type {
  GitCommitDetail,
  GitCommitSummary,
  GitFileChange,
  GitFileStatus,
  GitLogResponse,
  GitShowResponse,
} from "@ucode/contracts";

import { ERROR_CODES } from "@ucode/contracts";

import { GIT_SHOW_MAX_FILES } from "../../constants";
import { AppError } from "../response";
import { assertGitRef, runGit } from "./index";

/** 记录内字段分隔符（单元分隔符）；`git log` 的 `%x1f` 与之对应 */
const FIELD = "\u001f";

/** `git log` 的格式：hash / 短 hash / 标题 / 作者 / 时刻 / 装饰 */
const LOG_FORMAT = `--format=%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%aI${FIELD}%D`;

type RawCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authoredAt: string;
  refs: string;
};

const toSummary = (raw: RawCommit): GitCommitSummary => ({
  hash: raw.hash,
  shortHash: raw.shortHash,
  subject: raw.subject,
  authorName: raw.authorName,
  authoredAt: raw.authoredAt,
  refs: raw.refs
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean),
});

const parseCommitRecords = (stdout: string): RawCommit[] => {
  const records: RawCommit[] = [];
  for (const record of stdout.split("\0")) {
    if (!record.trim()) continue;
    const [hash, shortHash, subject, authorName, authoredAt, refs] = record.split(FIELD);
    if (!hash || !shortHash) continue;
    records.push({
      hash,
      shortHash,
      subject: subject ?? "",
      authorName: authorName ?? "",
      authoredAt: authoredAt ?? "",
      refs: refs ?? "",
    });
  }
  return records;
};

export const readLog = async (
  repoRoot: string,
  limit: number,
  skip: number,
): Promise<GitLogResponse> => {
  // 多取一条用于判断是否还有更早的提交；`-z` 让记录以 NUL 结尾而不是换行
  const result = await runGit(repoRoot, [
    "log",
    LOG_FORMAT,
    "-z",
    `--max-count=${limit + 1}`,
    `--skip=${skip}`,
  ]);
  const records = parseCommitRecords(result.stdout);
  const hasMore = records.length > limit;
  return { commits: records.slice(0, limit).map(toSummary), hasMore };
};

/** `--name-status` 的状态字符：`R100` / `C75` 这类带相似度的前缀只取首字母 */
const STATUS_BY_CHAR: Record<string, GitFileStatus> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "typeChanged",
  U: "conflicted",
};

/**
 * 解析 `--name-status -z` 的记录。带相似度的重命名 / 复制会多出一个原路径字段：
 * 记录内是 `R100\0旧\0新`，因此这里按字段流而不是按记录流读——
 * 保留重命名检测（不加 `--no-renames`），提交详情里的状态才与变更树同口径。
 */
const parseNameStatus = (stdout: string): GitFileChange[] => {
  const fields = stdout.split("\0").filter((field) => field !== "");
  const changes: GitFileChange[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const statusField = fields[index] ?? "";
    const char = statusField[0] ?? "";
    const status = STATUS_BY_CHAR[char];
    // 只认形状正确的记录：首字段必须是一个状态码
    if (!status || statusField.length > 5) continue;

    if (char === "R" || char === "C") {
      index += 1;
      const oldPath = fields[index];
      index += 1;
      const path = fields[index];
      if (!path) break;
      changes.push({ path, oldPath, status, additions: null, deletions: null });
      continue;
    }
    index += 1;
    const path = fields[index];
    if (!path) break;
    changes.push({ path, status, additions: null, deletions: null });
  }

  return changes;
};

export const readCommit = async (repoRoot: string, hash: string): Promise<GitShowResponse> => {
  const ref = assertGitRef(hash);
  const meta = await runGit(repoRoot, [
    "show",
    "--no-patch",
    `--format=%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%aI${FIELD}%D${FIELD}%b${FIELD}%P`,
    "-z",
    ref,
  ]);

  // `%b`（正文）与 `%P`（父提交）排在最后：正文里可能出现任意字符，只按最后两个字段切
  const parts = (meta.stdout.split("\0")[0] ?? "").split(FIELD);
  const [hashField, shortHash, subject, authorName, authoredAt, refs, body, parentsField] = parts;
  if (!hashField || !shortHash) {
    throw new AppError(ERROR_CODES.gitFailed, `未找到提交：${hash}`, 400, undefined, { hash });
  }

  const names = await runGit(repoRoot, ["show", "--name-status", "-z", "--format=", ref]);
  const files = parseNameStatus(names.stdout);
  const truncated = files.length > GIT_SHOW_MAX_FILES;

  const commit: GitCommitDetail = {
    hash: hashField,
    shortHash,
    subject: subject ?? "",
    authorName: authorName ?? "",
    authoredAt: authoredAt ?? "",
    refs: (refs ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    body: body ?? "",
    parents: (parentsField ?? "").split(" ").filter(Boolean),
  };
  return { commit, files: files.slice(0, GIT_SHOW_MAX_FILES), truncated };
};
