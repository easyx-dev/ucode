/** agents 域的请求 zod 模型：列出可选的 primary / subagent 角色（`plans/input-commands-skills.md`） */
import { z } from "zod";

import { sessionIdSchema } from "../sessions/input";

/**
 * 列举角色。优先按 `sessionId` 解析工作目录，其次用 `cwd`；
 * 项目级自定义角色按祖先链合并后返回。
 */
export const agentsListInputSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  cwd: z.string().min(1).optional(),
});

export type AgentsListRequest = z.input<typeof agentsListInputSchema>;
export type AgentsListInput = z.infer<typeof agentsListInputSchema>;
