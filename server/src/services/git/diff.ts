/**
 * unified diff 解析：把 `git diff` / `git show` 的输出折成结构化的 hunk。
 *
 * 只解析「单个文件」的 diff（调用方始终在命令末尾用 `-- <path>` 限定），因此文件身份来自入参而非
 * 头部行——`diff --git a/x b/x` 在路径含空格时本就是歧义的。头部只取状态线索：新增 / 删除 /
 * 重命名 / 复制 / 二进制，以及对两侧行号的起点。
 */

import type { GitDiffLine, GitFileDiff, GitFileStatus, GitHunk } from "@ucode/contracts";
import { GIT_DIFF_MAX_LINES } from "../../constants/tools";

/** `@@ -1,3 +1,4 @@ 函数上下文`：缺省计数为 1（`-0,0` 这种空侧也合法） */
const HUNK_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

type ParseState = {
  status: GitFileStatus;
  oldPath?: string;
  binary: boolean;
  additions: number;
  deletions: number;
  lineCount: number;
  truncated: boolean;
  hunks: GitHunk[];
};

export type ParseFileDiffOptions = {
  /** 初始状态；未跟踪文件的 diff 没有 `new file mode` 头部，由调用方直接给定 */
  status?: GitFileStatus;
};

const headerStatus = (line: string, state: ParseState): boolean => {
  if (line.startsWith("new file mode ")) {
    state.status = "added";
    return true;
  }
  if (line.startsWith("deleted file mode ")) {
    state.status = "deleted";
    return true;
  }
  if (line.startsWith("rename from ")) {
    state.status = "renamed";
    state.oldPath = line.slice("rename from ".length);
    return true;
  }
  if (line.startsWith("copy from ")) {
    state.status = "copied";
    state.oldPath = line.slice("copy from ".length);
    return true;
  }
  // 只换权限位（100644 → 100755）：git 用 T 表达，正文通常没有 hunk
  if (line.startsWith("old mode ") || line === "mode change") {
    state.status = "typeChanged";
    return true;
  }
  // 二进制差异不展开内容，只留一条说明行
  if (line.startsWith("Binary files ") || line === "GIT binary patch") {
    state.binary = true;
    return true;
  }
  return false;
};

/** 解析单个文件的 diff 正文；`path` 由调用方给出（见文件头注释） */
export const parseFileDiff = (
  path: string,
  stdout: string,
  options: ParseFileDiffOptions = {},
): GitFileDiff => {
  const state: ParseState = {
    status: options.status ?? "modified",
    binary: false,
    additions: 0,
    deletions: 0,
    lineCount: 0,
    truncated: false,
    hunks: [],
  };

  let current: GitHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of stdout.split("\n")) {
    if (line === "") continue;

    if (HUNK_PATTERN.test(line)) {
      const match = HUNK_PATTERN.exec(line);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[3] ?? 0);
      current = { header: line, lines: [] };
      state.hunks.push(current);
      continue;
    }

    if (current === null) {
      headerStatus(line, state);
      continue;
    }

    // hunk 内只认首字符：空格上下文、`+` 新增、`-` 删除、`\` 为「无行尾换行」标记
    const marker = line[0];
    if (marker !== " " && marker !== "+" && marker !== "-" && marker !== "\\") {
      // hunk 之后的头部（多文件场景下会再出现 `diff --git`），结束当前 hunk 的归属
      current = null;
      headerStatus(line, state);
      continue;
    }

    if (state.lineCount >= GIT_DIFF_MAX_LINES) {
      state.truncated = true;
      break;
    }
    state.lineCount += 1;

    if (marker === "\\") {
      // `\ No newline at end of file` 是行尾标记，不对应任何一行内容
      continue;
    }

    const text = line.slice(1);
    let entry: GitDiffLine;
    if (marker === "+") {
      entry = { kind: "add", oldLine: null, newLine, text };
      newLine += 1;
      state.additions += 1;
    } else if (marker === "-") {
      entry = { kind: "del", oldLine, newLine: null, text };
      oldLine += 1;
      state.deletions += 1;
    } else {
      entry = { kind: "ctx", oldLine, newLine, text };
      oldLine += 1;
      newLine += 1;
    }
    current.lines.push(entry);
  }

  return {
    path,
    ...(state.oldPath ? { oldPath: state.oldPath } : {}),
    status: state.status,
    binary: state.binary,
    additions: state.additions,
    deletions: state.deletions,
    hunks: state.hunks,
    truncated: state.truncated,
  };
};
