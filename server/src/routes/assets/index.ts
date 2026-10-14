/** /api/v1/assets：设置页的资产管理（角色 / 技能 / 命令的列举、详情与增删改） */
import {
  type AssetDeleteResponse,
  type AssetDetail,
  type AssetSaveResponse,
  type AssetsListResponse,
  assetsDeleteInputSchema,
  assetsListInputSchema,
  assetsReadInputSchema,
  assetsSaveInputSchema,
  ERROR_CODES,
} from "@ucode/contracts";
import { Hono } from "hono";
import { resolveSessionCwd } from "../../core/session-paths";
import { env } from "../../env";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";
import {
  type AssetContext,
  deleteAsset,
  listAssets,
  readAsset,
  saveAsset,
} from "../../services/assets";

/** 列举所用的工作目录：优先会话，其次显式 cwd，最后助理工作区（与 agents / commands 同口径） */
const resolveCwd = (services: Services, input: { sessionId?: string; cwd?: string }): string => {
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

/** 资产上下文：插件贡献的技能 / 命令目录与子角色都按该 cwd 的生效开关取 */
const contextOf = (
  services: Services,
  input: { sessionId?: string; cwd?: string },
): AssetContext => {
  const cwd = resolveCwd(services, input);
  return {
    cwd,
    appHome: env.homeDir,
    plugin: services.plugins.commandAssets(cwd),
    pluginAgents: services.plugins.agentProfiles(cwd),
  };
};

export const createAssetsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(assetsListInputSchema), (c) => {
    const input = c.req.valid("json");
    return c.json(ok(listAssets(contextOf(services, input)) satisfies AssetsListResponse));
  });

  router.post("/read", jsonBody(assetsReadInputSchema), (c) => {
    const input = c.req.valid("json");
    const detail = readAsset(contextOf(services, input), input.kind, input.path);
    return c.json(ok(detail satisfies AssetDetail));
  });

  router.post("/save", jsonBody(assetsSaveInputSchema), (c) => {
    const input = c.req.valid("json");
    const saved = saveAsset(contextOf(services, input), input);
    return c.json(ok(saved satisfies AssetSaveResponse));
  });

  router.post("/delete", jsonBody(assetsDeleteInputSchema), (c) => {
    const input = c.req.valid("json");
    const removed = deleteAsset(contextOf(services, input), input.kind, input.path);
    return c.json(ok(removed satisfies AssetDeleteResponse));
  });

  return router;
};
