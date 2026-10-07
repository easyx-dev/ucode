/** git 域的请求 zod 模型：变更列表、单文件 diff、提交历史与单次提交详情 */
import { z } from "zod";

import { GIT_DIFF_SOURCES } from "../constants";

/** 仓库状态与变更列表。`path` 可以是仓库内任意目录，服务端自行向上找仓库根 */
export const gitStatusInputSchema = z.object({
  path: z.string().min(1),
});

/**
 * 单个文件的 diff。`file` 与 `source` 组合确定对比对象：
 * `worktree` 比工作区与 index，`staged` 比 index 与 HEAD，`commit` 比该提交与它的父提交；
 * `context` 是上下文行数，越大越接近全文。
 *
 * 不用 `.refine` 表达「commit 必填」：封闭校验会变成 ZodEffects，接口文档生成器拿不到 JSON Schema；
 * 这一条由路由层校验。
 */
export const gitDiffInputSchema = z.object({
  path: z.string().min(1),
  file: z.string().min(1),
  source: z.enum(GIT_DIFF_SOURCES).default("worktree"),
  /** `source` 为 `commit` 时的提交 hash；其他来源忽略 */
  commit: z.string().min(1).optional(),
  context: z.number().int().min(0).max(200).default(3),
});

/** 提交历史：按时间倒序分页 */
export const gitLogInputSchema = z.object({
  path: z.string().min(1),
  limit: z.number().int().positive().max(100).default(30),
  skip: z.number().int().min(0).default(0),
});

/** 单次提交的元信息与文件列表；单个文件的 diff 走 `git/diff` 的 `commit` 分支按需取 */
export const gitShowInputSchema = z.object({
  path: z.string().min(1),
  hash: z.string().min(1),
});

export type GitStatusInput = z.infer<typeof gitStatusInputSchema>;
export type GitStatusRequest = z.input<typeof gitStatusInputSchema>;
export type GitDiffInput = z.infer<typeof gitDiffInputSchema>;
export type GitDiffRequest = z.input<typeof gitDiffInputSchema>;
export type GitLogInput = z.infer<typeof gitLogInputSchema>;
export type GitLogRequest = z.input<typeof gitLogInputSchema>;
export type GitShowInput = z.infer<typeof gitShowInputSchema>;
export type GitShowRequest = z.input<typeof gitShowInputSchema>;
