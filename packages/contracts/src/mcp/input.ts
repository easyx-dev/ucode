/** mcp 域的请求 zod 模型：MCP 服务器的增删改，`name` 作主键 */
import { z } from "zod";

import { DEFAULT_MCP_EXPOSURE, MCP_EXPOSURES } from "../constants";

/** 服务器名会拼进 `mcp__<server>__<tool>`，限制字符集避免与分隔符冲突 */
const mcpServerNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/** 环境变量 / 请求头：值可写 `${NAME}` 引用环境变量，解析交给 pi */
const mcpKeyValueSchema = z.record(z.string(), z.string());

/** 入参沿用 pi 的 `mcpServers` 形状，按 `type` 判别；同一份结构也用于落盘 */
export const mcpServerSchema = z.discriminatedUnion("type", [
  z.object({
    name: mcpServerNameSchema,
    enabled: z.boolean().default(true),
    exposure: z.enum(MCP_EXPOSURES).default(DEFAULT_MCP_EXPOSURE),
    /** 单请求超时（秒），省略即用 pi 默认 60 */
    timeout: z.number().int().positive().optional(),
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: mcpKeyValueSchema.optional(),
    /** 相对路径按会话工作目录解析 */
    cwd: z.string().min(1).optional(),
  }),
  z.object({
    name: mcpServerNameSchema,
    enabled: z.boolean().default(true),
    exposure: z.enum(MCP_EXPOSURES).default(DEFAULT_MCP_EXPOSURE),
    timeout: z.number().int().positive().optional(),
    type: z.literal("http"),
    url: z.string().min(1),
    headers: mcpKeyValueSchema.optional(),
  }),
]);

export const mcpListInputSchema = z.object({});

/** 按 `name` 覆盖写入：name 已存在则替换，否则新增 */
export const mcpUpsertInputSchema = mcpServerSchema;

export const mcpDeleteInputSchema = z.object({ name: mcpServerNameSchema });

export type McpServerInput = z.infer<typeof mcpServerSchema>;
export type McpListRequest = z.input<typeof mcpListInputSchema>;
export type McpListInput = z.infer<typeof mcpListInputSchema>;
export type McpUpsertRequest = z.input<typeof mcpUpsertInputSchema>;
export type McpUpsertInput = z.infer<typeof mcpUpsertInputSchema>;
export type McpDeleteRequest = z.input<typeof mcpDeleteInputSchema>;
export type McpDeleteInput = z.infer<typeof mcpDeleteInputSchema>;
