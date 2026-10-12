/** /api/v1/commands：列出可用的提示词命令与技能（`/` 菜单的数据源） */
import {
  type CommandsListInput,
  type CommandsListResponse,
  commandsListInputSchema,
  ERROR_CODES,
} from "@ucode/contracts";
import { Hono } from "hono";
import { resolveSessionCwd } from "../../core/session-paths";
import { env } from "../../env";
import { loadCommandAssets } from "../../harness/setup/assets";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

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
  return input.cwd ?? env.workspacesDir;
};

export const createCommandsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(commandsListInputSchema), async (c) => {
    const input = c.req.valid("json");
    // 生效开关按 cwd 算：插件资产必须和会话装配用同一个目录，否则菜单里会出现该仓库已关掉的技能
    const cwd = resolveCwd(services, input);
    const assets: CommandsListResponse = await loadCommandAssets({
      cwd,
      appHome: env.homeDir,
      harnessDir: env.harnessDir,
      plugin: services.plugins.commandAssets(cwd),
    });
    return c.json(ok(assets));
  });

  return router;
};
