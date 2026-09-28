/** /api/v1/sessions：会话的列表 / 新建 / 详情 / 更新 / 删除 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import { Hono } from "hono";
import { z } from "zod";

import type { Services } from "../app";
import { THINKING_LEVELS } from "../config/schema";
import { env } from "../env";
import { AppError, ok } from "../lib/result";
import { sessionIdSchema } from "../lib/schemas";
import { jsonBody } from "../lib/validate";
import { draftSessionSummary, sessionInfoToDTO } from "../pi/serialize";

const listSchema = z.object({
  q: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

const createSchema = z.object({
  name: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

const sessionIdBodySchema = z.object({ sessionId: sessionIdSchema });

const updateSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

type ListQuery = z.infer<typeof listSchema>;
type CreateInput = z.infer<typeof createSchema>;
type UpdatePatch = z.infer<typeof updateSchema>;

const runtimeDefaults = (services: Services) => {
  const status = services.runtime.getStatus();
  return { model: status.defaultModel, thinkingLevel: status.thinkingLevel };
};

const isBusy = (services: Services, sessionId: string): boolean =>
  services.pool.isRunning(sessionId) || services.pool.get(sessionId)?.isStreaming === true;

const assertModel = (services: Services, ref: string): void => {
  if (!services.runtime.resolveModelRef(ref)) {
    throw new AppError("unknown_model", `模型不可用：${ref}`, 400);
  }
};

/** 会话摘要：已落盘读文件，否则给草稿视图（只有覆盖值可展示） */
const describeSession = async (services: Services, sessionId: string) => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const override = services.sessionState.get(sessionId);
  const info = await services.pool.findInfo(sessionId);

  if (!info) {
    return {
      session: draftSessionSummary(sessionId, override, model, thinkingLevel, env.workspaceDir),
      persisted: false,
      entries: 0,
    };
  }

  const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
  return {
    session: sessionInfoToDTO(info, override, model, thinkingLevel),
    persisted: true,
    entries: manager.getEntries().length,
  };
};

const listSessions = async (services: Services, query: ListQuery) => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const infos = await services.pool.listInfos();

  let sessions = infos.map((info) =>
    sessionInfoToDTO(info, services.sessionState.get(info.id), model, thinkingLevel),
  );

  const needle = query.q?.trim().toLowerCase();
  if (needle) {
    sessions = sessions.filter(
      (item) =>
        item.id.toLowerCase().includes(needle) ||
        (item.name ?? "").toLowerCase().includes(needle) ||
        item.preview.toLowerCase().includes(needle),
    );
  }

  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { sessions: sessions.slice(0, query.limit), total: sessions.length };
};

/** 新建只返回 id 与草稿视图：会话文件在首次产生 assistant 回复时才落盘 */
const createSession = (services: Services, input: CreateInput) => {
  if (!services.runtime.getStatus().configured) {
    throw new AppError("model_not_configured", "尚未配置模型，请先在设置里添加 provider", 409);
  }
  if (input.model) assertModel(services, input.model);

  const sessionId = randomUUID();
  services.sessionState.set(sessionId, {
    ...(input.name ? { name: input.name } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
  });

  const { model, thinkingLevel } = runtimeDefaults(services);
  return draftSessionSummary(
    sessionId,
    services.sessionState.get(sessionId),
    model,
    thinkingLevel,
    env.workspaceDir,
  );
};

/** 名称 / 模型变更同时追加到会话文件，供 pi 重放（文件未落盘时跳过） */
const appendTranscriptPatch = (info: SessionInfo | undefined, patch: UpdatePatch): void => {
  if (!info) return;

  const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
  if (patch.name) manager.appendSessionInfo(patch.name);
  if (patch.model) {
    const separator = patch.model.indexOf("/");
    manager.appendModelChange(patch.model.slice(0, separator), patch.model.slice(separator + 1));
  }
  if (patch.thinkingLevel) manager.appendThinkingLevelChange(patch.thinkingLevel);
};

const updateSession = async (services: Services, patch: UpdatePatch) => {
  if (patch.model) assertModel(services, patch.model);
  if ((patch.model || patch.thinkingLevel) && isBusy(services, patch.sessionId)) {
    throw new AppError("session_busy", "会话正在生成，请先中断", 409);
  }

  appendTranscriptPatch(await services.pool.findInfo(patch.sessionId), patch);
  services.sessionState.set(patch.sessionId, {
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.thinkingLevel ? { thinkingLevel: patch.thinkingLevel } : {}),
  });

  // 换模型 / 换 thinking 需要重建会话实例才会生效，历史留在盘上
  if (patch.model || patch.thinkingLevel) services.pool.dispose(patch.sessionId);

  // 与 /create 一致，返回扁平摘要（/info 才是 {session, persisted, entries}）
  return (await describeSession(services, patch.sessionId)).session;
};

const deleteSession = async (services: Services, sessionId: string) => {
  if (isBusy(services, sessionId)) {
    throw new AppError("session_busy", "会话正在生成，请先中断", 409);
  }

  const info = await services.pool.findInfo(sessionId);
  services.pool.dispose(sessionId);
  services.sessionState.delete(sessionId);
  if (info) rmSync(info.path, { force: true });

  return { deleted: true, sessionId };
};

export const createSessionsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(listSchema), async (c) =>
    c.json(ok(await listSessions(services, c.req.valid("json")))),
  );
  router.post("/create", jsonBody(createSchema), (c) =>
    c.json(ok(createSession(services, c.req.valid("json")))),
  );
  router.post("/info", jsonBody(sessionIdBodySchema), async (c) =>
    c.json(ok(await describeSession(services, c.req.valid("json").sessionId))),
  );
  router.post("/update", jsonBody(updateSchema), async (c) =>
    c.json(ok(await updateSession(services, c.req.valid("json")))),
  );
  router.post("/delete", jsonBody(sessionIdBodySchema), async (c) =>
    c.json(ok(await deleteSession(services, c.req.valid("json").sessionId))),
  );

  return router;
};
