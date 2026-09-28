import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { SessionManager } from "@earendil-works/pi-coding-agent";
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

export const createSessionsRoute = (services: Services) => {
  const router = new Hono();

  const defaultModel = () => services.runtime.getStatus().defaultModel;
  const defaultThinkingLevel = () => services.runtime.getStatus().thinkingLevel;

  const assertModel = (ref: string) => {
    if (!services.runtime.resolveModelRef(ref)) {
      throw new AppError("unknown_model", `模型不可用：${ref}`, 400);
    }
  };

  const isBusy = (sessionId: string): boolean =>
    services.pool.isRunning(sessionId) || services.pool.get(sessionId)?.isStreaming === true;

  router.post("/list", jsonBody(listSchema), async (c) => {
    const { q, limit } = c.req.valid("json");
    const infos = await services.pool.listInfos();
    const model = defaultModel();
    const level = defaultThinkingLevel();

    let sessions = infos.map((info) =>
      sessionInfoToDTO(info, services.sessionState.get(info.id), model, level),
    );

    const needle = q?.trim().toLowerCase();
    if (needle) {
      sessions = sessions.filter(
        (item) =>
          item.id.toLowerCase().includes(needle) ||
          (item.name ?? "").toLowerCase().includes(needle) ||
          item.preview.toLowerCase().includes(needle),
      );
    }

    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return c.json(ok({ sessions: sessions.slice(0, limit), total: sessions.length }));
  });

  router.post("/create", jsonBody(createSchema), (c) => {
    const input = c.req.valid("json");
    if (!services.runtime.getStatus().configured) {
      throw new AppError("model_not_configured", "尚未配置模型，请先在设置里添加 provider", 409);
    }
    if (input.model) assertModel(input.model);

    const sessionId = randomUUID();
    if (input.name || input.cwd || input.model || input.thinkingLevel) {
      services.sessionState.set(sessionId, {
        ...(input.name ? { name: input.name } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      });
    }

    return c.json(
      ok(
        draftSessionSummary(
          sessionId,
          services.sessionState.get(sessionId),
          defaultModel(),
          defaultThinkingLevel(),
          env.workspaceDir,
        ),
      ),
    );
  });

  router.post("/info", jsonBody(sessionIdBodySchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    const override = services.sessionState.get(sessionId);
    const info = await services.pool.findInfo(sessionId);

    if (!info) {
      return c.json(
        ok({
          session: draftSessionSummary(
            sessionId,
            override,
            defaultModel(),
            defaultThinkingLevel(),
            env.workspaceDir,
          ),
          persisted: false,
          entries: 0,
        }),
      );
    }

    const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
    return c.json(
      ok({
        session: sessionInfoToDTO(info, override, defaultModel(), defaultThinkingLevel()),
        persisted: true,
        entries: manager.getEntries().length,
      }),
    );
  });

  router.post("/update", jsonBody(updateSchema), async (c) => {
    const { sessionId, name, model, thinkingLevel } = c.req.valid("json");
    if (model) assertModel(model);

    const info = await services.pool.findInfo(sessionId);

    if (info) {
      const manager = SessionManager.open(info.path, env.sessionsRoot, info.cwd);
      if (name) manager.appendSessionInfo(name);
      if (model) {
        const separator = model.indexOf("/");
        manager.appendModelChange(model.slice(0, separator), model.slice(separator + 1));
      }
      if (thinkingLevel) manager.appendThinkingLevelChange(thinkingLevel);
    }

    services.sessionState.set(sessionId, {
      ...(name ? { name } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });

    if (model || thinkingLevel) {
      if (isBusy(sessionId)) {
        throw new AppError("session_busy", "会话正在生成，请先中断", 409);
      }
      services.pool.dispose(sessionId);
    }

    const updated = await services.pool.findInfo(sessionId);
    return c.json(
      ok(
        updated
          ? sessionInfoToDTO(
              updated,
              services.sessionState.get(sessionId),
              defaultModel(),
              defaultThinkingLevel(),
            )
          : draftSessionSummary(
              sessionId,
              services.sessionState.get(sessionId),
              defaultModel(),
              defaultThinkingLevel(),
              env.workspaceDir,
            ),
      ),
    );
  });

  router.post("/delete", jsonBody(sessionIdBodySchema), async (c) => {
    const { sessionId } = c.req.valid("json");
    if (isBusy(sessionId)) {
      throw new AppError("session_busy", "会话正在生成，请先中断", 409);
    }

    const info = await services.pool.findInfo(sessionId);
    services.pool.dispose(sessionId);
    services.sessionState.delete(sessionId);
    if (info) rmSync(info.path, { force: true });

    return c.json(ok({ deleted: true, sessionId }));
  });

  return router;
};
