/** /api/v1/git：只读 git（变更列表、单文件 diff、提交历史、单次提交），供工作台面板使用 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  ERROR_CODES,
  type GitDiffInput,
  type GitDiffResponse,
  type GitLogInput,
  type GitLogResponse,
  type GitShowInput,
  type GitShowResponse,
  type GitStatusInput,
  type GitStatusResponse,
  gitDiffInputSchema,
  gitLogInputSchema,
  gitShowInputSchema,
  gitStatusInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import {
  assertGitRef,
  isTracked,
  repositoryRootOf,
  requireRepositoryRoot,
  resolveRepoPath,
  runDiff,
} from "../../lib/git";
import { parseFileDiff } from "../../lib/git/diff";
import { readCommit, readLog } from "../../lib/git/log";
import { readRepositoryStatus } from "../../lib/git/status";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

/** 未跟踪文件的 diff 需要 `--no-index` 与一个「空文件」参照；git 在 Windows 上也认 /dev/null */
const NULL_PATH = "/dev/null";

const status = async (input: GitStatusInput): Promise<GitStatusResponse> => {
  const repoRoot = repositoryRootOf(input.path);
  if (!repoRoot) {
    // 没装 git 或不在仓库内都不是错误：面板据此显示空态而不是报错
    return {
      isRepo: false,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      truncated: false,
    };
  }
  return readRepositoryStatus(repoRoot);
};

const fileDiff = async (input: GitDiffInput): Promise<GitDiffResponse> => {
  const repoRoot = requireRepositoryRoot(input.path);
  const file = resolveRepoPath(repoRoot, input.file);
  const unified = `-U${input.context}`;

  if (input.source === "staged") {
    const result = await runDiff(repoRoot, ["diff", "--cached", unified, "--", file]);
    return parseFileDiff(file, result.stdout);
  }

  if (input.source === "commit") {
    if (!input.commit) {
      throw new AppError(
        ERROR_CODES.invalidRequest,
        "source 为 commit 时必须给 commit",
        400,
        undefined,
        { path: input.file },
      );
    }
    const ref = assertGitRef(input.commit);
    const result = await runDiff(repoRoot, ["show", unified, "--format=", ref, "--", file]);
    return parseFileDiff(file, result.stdout);
  }

  const result = await runDiff(repoRoot, ["diff", unified, "--", file]);
  if (result.stdout.trim() !== "") return parseFileDiff(file, result.stdout);

  // 工作区 diff 为空：已跟踪的文件就是真的没有差异（例如刚被提交 / 还原），
  // 只有未被跟踪的新文件才需要换个比法——`git diff` 对它什么都不输出
  if (await isTracked(repoRoot, file)) return parseFileDiff(file, "");
  if (!existsSync(join(repoRoot, file))) return parseFileDiff(file, "");
  const untracked = await runDiff(repoRoot, [
    "diff",
    unified,
    "--no-index",
    "--",
    NULL_PATH,
    join(repoRoot, file),
  ]);
  return parseFileDiff(file, untracked.stdout, { status: "added" });
};

export const createGitRoute = () => {
  const router = new Hono();

  router.post("/status", jsonBody(gitStatusInputSchema), async (c) =>
    c.json(ok(await status(c.req.valid("json")))),
  );

  router.post("/diff", jsonBody(gitDiffInputSchema), async (c) =>
    c.json(ok(await fileDiff(c.req.valid("json")))),
  );

  router.post("/log", jsonBody(gitLogInputSchema), async (c) => {
    const input: GitLogInput = c.req.valid("json");
    const repoRoot = requireRepositoryRoot(input.path);
    const result: GitLogResponse = await readLog(repoRoot, input.limit, input.skip);
    return c.json(ok(result));
  });

  router.post("/show", jsonBody(gitShowInputSchema), async (c) => {
    const input: GitShowInput = c.req.valid("json");
    const repoRoot = requireRepositoryRoot(input.path);
    const result: GitShowResponse = await readCommit(repoRoot, input.hash);
    return c.json(ok(result));
  });

  return router;
};
