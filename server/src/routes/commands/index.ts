/** /api/v1/commands：列出可用的提示词命令与技能（`/` 菜单的数据源） */
import {
  type CommandsListInput,
  type CommandsListResponse,
  commandsListInputSchema,
  ERROR_CODES,
} from "@ucode/contracts";
import { Hono } from "hono";

import { loadCommandAssets } from "../../agent/assets";
import { resolveSessionCwd } from "../../agent/session-config";
import type { Services } from "../../app";
import { env } from "../../env";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

/** 列举所用的工作目录：优先会话，其次显式 cwd，最后助理工作区 */
const resolveCwd = (services: Services, input: CommandsListInput): string => {
  if (input.sessionId) {
    const record = services.sessions.find(input.sessionId);
    if (!record) {
      throw new AppError(ERROR_CODES.notFound, `会话不存在：${input.sessionId}`, 404, undefined, {
        path: input.sessionId,
      });
    }
    return resolveSessionCwd(record);
  }
  return input.cwd ?? env.workspaceRoot;
};

export const createCommandsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(commandsListInputSchema), async (c) => {
    const input = c.req.valid("json");
    const assets: CommandsListResponse = await loadCommandAssets({
      cwd: resolveCwd(services, input),
      appHome: env.homeDir,
      agentDir: env.agentDir,
    });
    return c.json(ok(assets));
  });

  return router;
};
