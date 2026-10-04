/** commands 域的请求 zod 模型：列出提示词命令与技能（`plans/input-commands-skills.md`） */
import { z } from "zod";

import { sessionIdSchema } from "../sessions/input";

/**
 * 列举命令与技能。优先按 `sessionId` 解析工作目录，其次用 `cwd`；
 * 两者都缺省时服务端回落到助理工作区。
 */
export const commandsListInputSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  cwd: z.string().min(1).optional(),
});

export type CommandsListRequest = z.input<typeof commandsListInputSchema>;
export type CommandsListInput = z.infer<typeof commandsListInputSchema>;
