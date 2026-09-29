/** /api/v1/sessions：会话的列表 / 新建 / 详情 / 更新 / 删除 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { type SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  ERROR_CODES,
  type SessionCreateInput,
  type SessionDeleteResponse,
  type SessionInfoResponse,
  type SessionListInput,
  type SessionListResponse,
  type SessionSummary,
  type SessionUpdateInput,
  sessionCreateInputSchema,
  sessionIdInputSchema,
  sessionListInputSchema,
  sessionUpdateInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { draftSessionSummary, sessionInfoToDTO } from "../../core/serialize";
import { env } from "../../env";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

const runtimeDefaults = (services: Services) => {
  const status = services.runtime.getStatus();
  return { model: status.defaultModel, thinkingLevel: status.thinkingLevel };
};

const assertModel = (services: Services, ref: string): void => {
  if (!services.runtime.resolveModelRef(ref)) {
    throw new AppError(ERROR_CODES.unknownModel, `模型不可用：${ref}`, 400);
  }
};

/** 会话摘要：已落盘读文件，否则给草稿视图（只有覆盖值可展示） */
const describeSession = async (
  services: Services,
  sessionId: string,
): Promise<SessionInfoResponse> => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const override = services.sessionState.get(sessionId);
  const info = await services.pool.findInfo(sessionId);

  if (!info) {
    return {
      session: draftSessionSummary(
        sessionId,
        override,
        model,
        thinkingLevel,
        env.workspaceDir,
        services.pool.isActive(sessionId),
      ),
      persisted: false,
      entries: 0,
    };
  }

  const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
  return {
    session: sessionInfoToDTO(
      info,
      override,
      model,
      thinkingLevel,
      services.pool.isActive(sessionId),
    ),
    persisted: true,
    entries: manager.getEntries().length,
  };
};

const listSessions = async (
  services: Services,
  query: SessionListInput,
): Promise<SessionListResponse> => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const infos = await services.pool.listInfos();

  let sessions = infos.map((info) =>
    sessionInfoToDTO(
      info,
      services.sessionState.get(info.id),
      model,
      thinkingLevel,
      services.pool.isActive(info.id),
    ),
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
const createSession = (services: Services, input: SessionCreateInput): SessionSummary => {
  if (!services.runtime.getStatus().configured) {
    throw new AppError(
      ERROR_CODES.modelNotConfigured,
      "尚未配置模型，请先在设置里添加 provider",
      409,
    );
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
    false,
  );
};

/** 名称 / 模型变更同时追加到会话文件，供 pi 重放（文件未落盘时跳过） */
const appendTranscriptPatch = (info: SessionInfo | undefined, patch: SessionUpdateInput): void => {
  if (!info) return;

  const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
  if (patch.name) manager.appendSessionInfo(patch.name);
  if (patch.model) {
    const separator = patch.model.indexOf("/");
    manager.appendModelChange(patch.model.slice(0, separator), patch.model.slice(separator + 1));
  }
  if (patch.thinkingLevel) manager.appendThinkingLevelChange(patch.thinkingLevel);
};

const updateSession = async (
  services: Services,
  patch: SessionUpdateInput,
): Promise<SessionSummary> => {
  if (patch.model) assertModel(services, patch.model);
  if ((patch.model || patch.thinkingLevel) && services.pool.isActive(patch.sessionId)) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
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

const deleteSession = async (
  services: Services,
  sessionId: string,
): Promise<SessionDeleteResponse> => {
  if (services.pool.isActive(sessionId)) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }

  const info = await services.pool.findInfo(sessionId);
  services.pool.dispose(sessionId);
  services.sessionState.delete(sessionId);
  services.events.remove(sessionId);
  if (info) rmSync(info.path, { force: true });

  return { deleted: true, sessionId };
};

export const createSessionsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(sessionListInputSchema), async (c) =>
    c.json(ok(await listSessions(services, c.req.valid("json")))),
  );
  router.post("/create", jsonBody(sessionCreateInputSchema), (c) =>
    c.json(ok(createSession(services, c.req.valid("json")))),
  );
  router.post("/info", jsonBody(sessionIdInputSchema), async (c) =>
    c.json(ok(await describeSession(services, c.req.valid("json").sessionId))),
  );
  router.post("/update", jsonBody(sessionUpdateInputSchema), async (c) =>
    c.json(ok(await updateSession(services, c.req.valid("json")))),
  );
  router.post("/delete", jsonBody(sessionIdInputSchema), async (c) =>
    c.json(ok(await deleteSession(services, c.req.valid("json").sessionId))),
  );

  return router;
};
