/** /api/v1/sessions：会话的列表 / 新建 / 详情 / 更新 / 归档 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  ERROR_CODES,
  type SessionArchiveResponse,
  type SessionCreateInput,
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
import { resolveSessionCwd } from "../../agent/session-config";
import { workspaceDirOf } from "../../agent/workspace";
import type { Services } from "../../app";
import { draftSessionSummary, sessionInfoToDTO } from "../../core/serialize";
import { assertModel, createSession } from "../../core/session";
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

/**
 * 会话摘要：已落盘读行里的缓存，否则给草稿视图（只有覆盖值可展示）。
 * 行不存在才 404——草稿会话（尚未落盘）也有行，据此把「无行」与「有行未落盘」区分开，
 * 客户端才能把 URL 里已消失的会话清掉而不是渲染成空会话。
 */
const describeSession = (services: Services, sessionId: string): SessionInfoResponse => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  const override = overrideOf(record);
  const running = services.pool.isActive(sessionId);

  if (!record.sourcePath) {
    return {
      session: draftSessionSummary(
        sessionId,
        override,
        model,
        thinkingLevel,
        workspaceDirOf(sessionId),
        running,
        record.childCount,
        { createdAt: record.createdAt, updatedAt: record.updatedAt },
      ),
    };
  }

  return {
    session: sessionInfoToDTO(
      infoFromRecord(record),
      override,
      model,
      thinkingLevel,
      running,
      record.childCount,
    ),
  };
};

const listSessions = (services: Services, query: SessionListInput): SessionListResponse => {
  const { model, thinkingLevel } = runtimeDefaults(services);
  const { records, total } = services.sessions.search(query);

  // 已落盘行读行里的缓存；草稿行只有覆盖值可展示，用行里的真实时间保持排序口径一致
  const sessions = records.map((record) => {
    const running = services.pool.isActive(record.id);
    return record.sourcePath
      ? sessionInfoToDTO(
          infoFromRecord(record),
          overrideOf(record),
          model,
          thinkingLevel,
          running,
          record.childCount,
        )
      : draftSessionSummary(
          record.id,
          overrideOf(record),
          model,
          thinkingLevel,
          workspaceDirOf(record.id),
          running,
          record.childCount,
          { createdAt: record.createdAt, updatedAt: record.updatedAt },
        );
  });

  return { sessions, total };
};

/**
 * 新建只返回 id 与草稿视图：会话文件在首次产生 assistant 回复时才落盘。
 */
const createSessionRoute = (services: Services, input: SessionCreateInput): SessionSummary => {
  if (!services.runtime.getStatus().configured) {
    throw new AppError(
      ERROR_CODES.modelNotConfigured,
      "尚未配置模型，请先在设置里添加 provider",
      409,
    );
  }
  if (input.model) assertModel(services, input.model);

  const sessionId = createSession(services, input);

  const { model, thinkingLevel } = runtimeDefaults(services);
  return draftSessionSummary(
    sessionId,
    services.sessions.get(sessionId),
    model,
    thinkingLevel,
    workspaceDirOf(sessionId),
    false,
    0,
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
  if (
    (patch.model || patch.thinkingLevel || patch.mode) &&
    services.pool.isActive(patch.sessionId)
  ) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }

  const record = services.sessions.find(patch.sessionId);
  // 仓储的 set 是 upsert，不拦的话会给不存在的会话凭空建一行
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${patch.sessionId}`, 404, undefined, {
      path: patch.sessionId,
    });
  }
  if (record.sourcePath) {
    const manager = appendTranscriptPatch(record.sourcePath, resolveSessionCwd(record), patch);
    const index = indexFromManager(manager);
    if (index) services.sessions.refresh(patch.sessionId, index);
  }

  services.sessions.set(patch.sessionId, {
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.thinkingLevel ? { thinkingLevel: patch.thinkingLevel } : {}),
    ...(patch.mode ? { mode: patch.mode } : {}),
  });

  // 换模型 / 换 thinking / 换模式需要重建会话实例才会生效，历史留在盘上
  if (patch.model || patch.thinkingLevel || patch.mode) services.pool.dispose(patch.sessionId);

  // 与 /create 一致，返回扁平摘要（/info 才是 {session}）
  return describeSession(services, patch.sessionId).session;
};

/** 归档（软删）：只写 `deleted_at`，行、JSONL 与工作区目录都保留；子会话随父级联归档 */
const archiveSession = (services: Services, sessionId: string): SessionArchiveResponse => {
  // 子会话只能查看、不会独立在跑，但归档是破坏性动作，仍对整棵子树做一次忙碌校验
  const targets = [sessionId, ...services.sessions.descendantIds(sessionId)];
  if (targets.some((id) => services.pool.isActive(id))) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }

  for (const id of targets) {
    services.pool.dispose(id);
    services.events.remove(id);
    // 会话归档后，挂起的审批与「本会话恒允」都失去意义
    services.interactions.forget(id);
    services.permissions.clear(id);
    services.sessions.archive(id);
  }

  return { archived: true, sessionId };
};

export const createSessionsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(sessionListInputSchema), (c) =>
    c.json(ok(listSessions(services, c.req.valid("json")))),
  );
  router.post("/create", jsonBody(sessionCreateInputSchema), (c) =>
    c.json(ok(createSessionRoute(services, c.req.valid("json")))),
  );
  router.post("/info", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(describeSession(services, c.req.valid("json").sessionId))),
  );
  router.post("/update", jsonBody(sessionUpdateInputSchema), (c) =>
    c.json(ok(updateSession(services, c.req.valid("json")))),
  );
  router.post("/archive", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(archiveSession(services, c.req.valid("json").sessionId))),
  );

  return router;
};
