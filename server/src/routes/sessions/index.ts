/** /api/v1/sessions：会话的列表 / 新建 / 详情 / 更新 / 删除 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { SessionManager } from "@earendil-works/pi-coding-agent";
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
  type ThinkingLevel,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { draftSessionSummary, sessionInfoToDTO } from "../../core/serialize";
import { indexFromManager, infoFromRecord } from "../../core/session-index";
import { overrideOf } from "../../db/session-repository";
import { env } from "../../env";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

const runtimeDefaults = (
  services: Services,
): { model: string | null; thinkingLevel: ThinkingLevel } => {
  const status = services.runtime.getStatus();
  return { model: status.defaultModel, thinkingLevel: status.thinkingLevel };
};

const assertModel = (services: Services, ref: string): void => {
  if (!services.runtime.resolveModelRef(ref)) {
    throw new AppError(ERROR_CODES.unknownModel, `模型不可用：${ref}`, 400);
  }
};

/** 会话摘要：索引已落盘就直接读行，否则给草稿视图（只有覆盖值可展示） */
const describeSession = (services: Services, sessionId: string): SessionInfoResponse => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const record = services.sessions.find(sessionId);
  const override = overrideOf(record);
  const running = services.pool.isActive(sessionId);

  if (!record?.persisted || !record.sourcePath) {
    return {
      session: draftSessionSummary(
        sessionId,
        override,
        model,
        thinkingLevel,
        env.workspaceDir,
        running,
      ),
      persisted: false,
      entries: 0,
    };
  }

  return {
    session: sessionInfoToDTO(infoFromRecord(record), override, model, thinkingLevel, running),
    persisted: true,
    entries: record.entryCount,
  };
};

const listSessions = (services: Services, query: SessionListInput): SessionListResponse => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const { records, total } = services.sessions.search(query);

  const sessions = records.map((record) =>
    sessionInfoToDTO(
      infoFromRecord(record),
      overrideOf(record),
      model,
      thinkingLevel,
      services.pool.isActive(record.id),
    ),
  );

  return { sessions, total };
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
  services.sessions.create(sessionId, {
    ...(input.name ? { name: input.name } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
  });

  const { model, thinkingLevel } = runtimeDefaults(services);
  return draftSessionSummary(
    sessionId,
    services.sessions.get(sessionId),
    model,
    thinkingLevel,
    env.workspaceDir,
    false,
  );
};

/** 名称 / 模型变更同时追加到会话文件，供 pi 重放 */
const appendTranscriptPatch = (
  sourcePath: string,
  cwd: string,
  patch: SessionUpdateInput,
): SessionManager => {
  const manager = SessionManager.open(sourcePath, env.sessionsRoot, cwd);
  if (patch.name) manager.appendSessionInfo(patch.name);
  if (patch.model) {
    const separator = patch.model.indexOf("/");
    manager.appendModelChange(patch.model.slice(0, separator), patch.model.slice(separator + 1));
  }
  if (patch.thinkingLevel) manager.appendThinkingLevelChange(patch.thinkingLevel);
  return manager;
};

const updateSession = (services: Services, patch: SessionUpdateInput): SessionSummary => {
  if (patch.model) assertModel(services, patch.model);
  if ((patch.model || patch.thinkingLevel) && services.pool.isActive(patch.sessionId)) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }

  const record = services.sessions.find(patch.sessionId);
  if (record?.sourcePath) {
    const cwd = record.piCwd || record.cwd || env.workspaceDir;
    const manager = appendTranscriptPatch(record.sourcePath, cwd, patch);
    const index = indexFromManager(manager);
    if (index) services.sessions.refresh(patch.sessionId, index);
  }

  services.sessions.set(patch.sessionId, {
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.thinkingLevel ? { thinkingLevel: patch.thinkingLevel } : {}),
  });

  // 换模型 / 换 thinking 需要重建会话实例才会生效，历史留在盘上
  if (patch.model || patch.thinkingLevel) services.pool.dispose(patch.sessionId);

  // 与 /create 一致，返回扁平摘要（/info 才是 {session, persisted, entries}）
  return describeSession(services, patch.sessionId).session;
};

const deleteSession = (services: Services, sessionId: string): SessionDeleteResponse => {
  if (services.pool.isActive(sessionId)) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }

  const record = services.sessions.find(sessionId);
  services.pool.dispose(sessionId);
  services.sessions.delete(sessionId);
  services.events.remove(sessionId);
  if (record?.sourcePath) rmSync(record.sourcePath, { force: true });

  return { deleted: true, sessionId };
};

export const createSessionsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(sessionListInputSchema), (c) =>
    c.json(ok(listSessions(services, c.req.valid("json")))),
  );
  router.post("/create", jsonBody(sessionCreateInputSchema), (c) =>
    c.json(ok(createSession(services, c.req.valid("json")))),
  );
  router.post("/info", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(describeSession(services, c.req.valid("json").sessionId))),
  );
  router.post("/update", jsonBody(sessionUpdateInputSchema), (c) =>
    c.json(ok(updateSession(services, c.req.valid("json")))),
  );
  router.post("/delete", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(deleteSession(services, c.req.valid("json").sessionId))),
  );

  return router;
};
