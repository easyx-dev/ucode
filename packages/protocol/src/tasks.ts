import { z } from "zod";
import { AutonomyLevelSchema } from "./trust.ts";

/**
 * 自动化任务的**线上形状**（F-4.1~4.5）。
 *
 * 控制层（Web/桌面/TUI）据此渲染"自动化面板"，核心层返回的任务对象结构与之兼容。
 * 用 `passthrough` 而非严格模式：核心层内部的运行历史/跳过记录可能继续长字段，
 * 面板不该因为多一个字段就解析失败。
 */

export const TaskKindSchema = z.enum(["cron", "idle"]);
export const TaskStatusSchema = z.enum(["active", "paused", "completed", "cancelled"]);

export const TaskRunSchema = z
  .object({
    at: z.string(),
    sessionId: z.string(),
    status: z.enum(["completed", "failed", "skipped"]),
    note: z.string().optional(),
  })
  .passthrough();

export const TaskSkipSchema = z.object({ at: z.string(), reason: z.string() }).passthrough();

export const TaskSummarySchema = z
  .object({
    id: z.string(),
    kind: TaskKindSchema,
    status: TaskStatusSchema,
    prompt: z.string(),
    cwd: z.string(),
    sessionId: z.string().nullable().optional(),
    cron: z.string().optional(),
    delayMinutes: z.number().optional(),
    everyMinutes: z.number().optional(),
    autonomy: AutonomyLevelSchema.optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    nextRunAt: z.string().optional(),
    lastRunAt: z.string().optional(),
    runs: z.array(TaskRunSchema).optional(),
    skipped: z.array(TaskSkipSchema).optional(),
  })
  .passthrough();

export type TaskKind = z.infer<typeof TaskKindSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskRun = z.infer<typeof TaskRunSchema>;
export type TaskSummary = z.infer<typeof TaskSummarySchema>;
