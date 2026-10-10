/**
 * 对比两侧的文件内容：给编辑器「展开未变更区域」提供原文。
 *
 * 服务端的 hunk 只带 3 行上下文，hunk 之外的行要看内容就得回原文。两侧与 `git/diff` 的对比对象
 * 完全一致（工作区 vs index、index vs HEAD、提交 vs 父提交），只是这里给整份文本而不是差异。
 *
 * 从 git 对象读的一侧**先问大小再读内容**：`git show` 会把整块塞进内存，而这里只是「够不够内联」
 * 的问题，超限时给一个标志比让它撞上执行缓冲上限要好。工作区一侧走 `fs/read` 的同一套判定。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  GitContentsInput,
  GitContentsResponse,
  GitDiffSource,
  GitFileVersion,
} from "@ucode/contracts";
import { ERROR_CODES } from "@ucode/contracts";

import { FS_BINARY_SNIFF_BYTES, FS_READ_TEXT_MAX_BYTES } from "../../constants";
import { readFileContent } from "../file-content";
import { AppError } from "../response";
import { assertGitRef, runGit } from "./index";

/** 对比的一侧取自哪里：git 对象（index / HEAD / 某次提交）或工作区磁盘 */
type SideSpec = { kind: "git"; rev: string } | { kind: "worktree" };

/** 两侧的来源；`commit` 来源缺 hash 时按请求非法处理（与 `git/diff` 同一口径） */
const sidesOf = (
  source: GitDiffSource,
  commit: string | undefined,
  file: string,
): { old: SideSpec | null; new: SideSpec | null } => {
  if (source === "staged") {
    return { old: { kind: "git", rev: "HEAD" }, new: { kind: "git", rev: ":0" } };
  }
  if (source === "commit") {
    if (!commit) {
      throw new AppError(
        ERROR_CODES.invalidRequest,
        "source 为 commit 时必须给 commit",
        400,
        undefined,
        { path: file },
      );
    }
    const ref = assertGitRef(commit);
    // 首次提交没有父提交，`<ref>^` 取不到，旧侧自然缺失
    return { old: { kind: "git", rev: `${ref}^` }, new: { kind: "git", rev: ref } };
  }
  // 工作区：index 是基准，工作区文件是目标（未跟踪时 index 侧缺失）
  return { old: { kind: "git", rev: ":0" }, new: { kind: "worktree" } };
};

const readGitVersion = async (
  repoRoot: string,
  rev: string,
  file: string,
): Promise<GitFileVersion | null> => {
  const spec = `${rev}:${file}`;

  const sized = await runGit(repoRoot, ["cat-file", "-s", spec]);
  if (sized.code !== 0) return null;
  const bytes = Number(sized.stdout.trim());
  // 0 字节是合法的空文件（取不到大小才是 null），不能当「这一侧没有内容」
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes > FS_READ_TEXT_MAX_BYTES) return { binary: false, truncated: true };

  const content = await runGit(repoRoot, ["show", spec]);
  if (content.code !== 0) return null;
  // 二进制判定与 `fs/read` 同口径：前 8KB 里出现 NUL 即算
  const probe = content.stdout.slice(0, FS_BINARY_SNIFF_BYTES);
  if (probe.includes("\u0000")) return { binary: true, truncated: false };
  return { text: content.stdout, binary: false, truncated: false };
};

const readWorktreeVersion = (repoRoot: string, file: string): GitFileVersion | null => {
  const absolute = join(repoRoot, file);
  if (!existsSync(absolute)) return null;
  try {
    const read = readFileContent({ path: absolute });
    return read.kind === "binary"
      ? { binary: true, truncated: read.truncated }
      : { text: read.text ?? "", binary: false, truncated: read.truncated };
  } catch {
    // 目录、权限不足等：当作「该侧没有内容」，不该因此打断 diff 的展示
    return null;
  }
};

const readSide = (
  repoRoot: string,
  side: SideSpec | null,
  file: string,
): Promise<GitFileVersion | null> => {
  if (!side) return Promise.resolve(null);
  return side.kind === "worktree"
    ? Promise.resolve(readWorktreeVersion(repoRoot, file))
    : readGitVersion(repoRoot, side.rev, file);
};

export const readDiffContents = async (
  repoRoot: string,
  input: GitContentsInput,
): Promise<GitContentsResponse> => {
  const sides = sidesOf(input.source, input.commit, input.file);
  const [oldVersion, newVersion] = await Promise.all([
    readSide(repoRoot, sides.old, input.file),
    readSide(repoRoot, sides.new, input.file),
  ]);

  return {
    path: input.file,
    ...(oldVersion ? { old: oldVersion } : {}),
    ...(newVersion ? { new: newVersion } : {}),
  };
};
