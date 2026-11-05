/** /api/v1/git：只读 git（变更列表、单文件 diff、提交历史、单次提交），供工作台面板使用 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  ERROR_CODES,
  type GitContentsInput,
  type GitContentsResponse,
  type GitDiffInput,
  type GitDiffResponse,
  type GitLogInput,
  type GitLogResponse,
  type GitShowInput,
  type GitShowResponse,
  type GitStatusInput,
  type GitStatusResponse,
  gitContentsInputSchema,
  gitDiffInputSchema,
  gitLogInputSchema,
  gitShowInputSchema,
  gitStatusInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import {
  assertGitRef,
  isTracked,
  repositoryRootOf,
  requireRepositoryRoot,
  resolveRepoPath,
  runDiff,
} from "../../services/git";
import { readDiffContents } from "../../services/git/contents";
import { parseFileDiff } from "../../services/git/diff";
import { readCommit, readLog } from "../../services/git/log";
import { readRepositoryStatus } from "../../services/git/status";
import { resolveGitTarget } from "../../services/git/submodules";

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
    // 提交属于主仓库历史：子模块在其中只记指针，不会出现子模块内的路径
    const ref = assertGitRef(input.commit);
    const result = await runDiff(repoRoot, ["show", unified, "--format=", ref, "--", file]);
    return parseFileDiff(file, result.stdout);
  }

  // 子模块内的文件要在子模块仓库里比，主仓库只记得到指针；回给客户端的仍是主仓库相对路径
  const target = await resolveGitTarget(repoRoot, file);

  if (input.source === "staged") {
    const result = await runDiff(target.root, ["diff", "--cached", unified, "--", target.path]);
    return parseFileDiff(file, result.stdout);
  }

  const result = await runDiff(target.root, ["diff", unified, "--", target.path]);
  if (result.stdout.trim() !== "") return parseFileDiff(file, result.stdout);

  // 工作区 diff 为空：已跟踪的文件就是真的没有差异（例如刚被提交 / 还原），
  // 只有未被跟踪的新文件才需要换个比法——`git diff` 对它什么都不输出
  if (await isTracked(target.root, target.path)) return parseFileDiff(file, "");
  if (!existsSync(join(target.root, target.path))) return parseFileDiff(file, "");
  const untracked = await runDiff(target.root, [
    "diff",
    unified,
    "--no-index",
    "--",
    NULL_PATH,
    join(target.root, target.path),
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

  router.post("/contents", jsonBody(gitContentsInputSchema), async (c) => {
    const input: GitContentsInput = c.req.valid("json");
    const repoRoot = requireRepositoryRoot(input.path);
    const file = resolveRepoPath(repoRoot, input.file);
    const result: GitContentsResponse = await readDiffContents(repoRoot, { ...input, file });
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
