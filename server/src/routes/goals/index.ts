/** /api/v1/goals：会话目标的设定 / 查看 / 暂停 / 恢复 / 清除 */
import {
  ERROR_CODES,
  type GoalResponse,
  type GoalSetInput,
  goalSetInputSchema,
  type SessionIdInput,
  sessionIdInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import { buildGoalKickoff, buildGoalResume } from "../../agent/goal/prompt";
import type { Services } from "../../app";
import { admitGoalRun } from "../../core/run";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

const requireSession = (services: Services, sessionId: string) => {
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  return record;
};

/** 按最新状态组装统一响应；目标由存储状态 + 实时用量现算 */
const goalResponse = (services: Services, sessionId: string): GoalResponse => {
  const record = services.sessions.find(sessionId);
  return {
    sessionId,
    goal: record ? services.goals.view(record, services.pool.get(sessionId)) : null,
  };
};

/** 设定 / 替换目标：只允许主会话的 build 模式，且会话空闲；随后立即起第一轮 */
const setGoal = async (services: Services, input: GoalSetInput): Promise<GoalResponse> => {
  if (!services.runtime.getStatus().configured) {
    throw new AppError(
      ERROR_CODES.modelNotConfigured,
      "尚未配置模型，请先在设置里添加 provider",
      409,
    );
  }
  const record = requireSession(services, input.sessionId);
  if (record.parentSessionId || record.agent) {
    throw new AppError(ERROR_CODES.invalidRequest, "子会话不支持设置目标", 400);
  }
  if (record.mode !== "build") {
    throw new AppError(ERROR_CODES.invalidRequest, "只有编码模式可以设置目标", 400);
  }
  if (services.pool.isActive(input.sessionId)) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断或等本轮结束", 409);
  }

  const view = services.goals.set(
    record,
    { objective: input.objective, tokenBudget: input.tokenBudget ?? null },
    services.pool.get(input.sessionId),
  );
  try {
    await admitGoalRun(services, input.sessionId, buildGoalKickoff(view.objective));
  } catch (error) {
    // 起不来就别让目标停在 active：暂停保留目标，用户可稍后恢复
    services.goals.pause(record, "error", services.pool.get(input.sessionId));
    throw error;
  }
  return goalResponse(services, input.sessionId);
};

/** 暂停：从 active 迁移时中断当前轮；无 active 目标时不打扰正在进行的生成 */
const pauseGoal = async (services: Services, sessionId: string): Promise<GoalResponse> => {
  const record = requireSession(services, sessionId);
  const live = services.pool.get(sessionId);
  const before = services.goals.view(record, live);
  services.goals.pause(record, "user", live);
  if (before?.status === "active") await services.pool.abort(sessionId);
  return goalResponse(services, sessionId);
};

/** 恢复：仅当确实由 paused 迁回 active 且会话空闲时起一轮；其余情况交给已有轮次落定后接管 */
const resumeGoal = async (services: Services, sessionId: string): Promise<GoalResponse> => {
  const record = requireSession(services, sessionId);
  const live = services.pool.get(sessionId);
  const before = services.goals.view(record, live);
  const view = services.goals.resume(record, live);
  if (
    before?.status === "paused" &&
    view?.status === "active" &&
    !services.pool.isActive(sessionId)
  ) {
    try {
      await admitGoalRun(services, sessionId, buildGoalResume(view.objective));
    } catch (error) {
      services.goals.pause(record, "error", services.pool.get(sessionId));
      throw error;
    }
  }
  return goalResponse(services, sessionId);
};

/** 清除目标；不中断当前轮，仅停止后续续跑 */
const clearGoal = (services: Services, sessionId: string): GoalResponse => {
  const record = requireSession(services, sessionId);
  services.goals.clear(record);
  return { sessionId, goal: null };
};

export const createGoalsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/set", jsonBody(goalSetInputSchema), async (c) =>
    c.json(ok(await setGoal(services, c.req.valid("json")))),
  );
  router.post("/status", jsonBody(sessionIdInputSchema), (c) => {
    const { sessionId } = c.req.valid("json") satisfies SessionIdInput;
    requireSession(services, sessionId);
    return c.json(ok(goalResponse(services, sessionId)));
  });
  router.post("/pause", jsonBody(sessionIdInputSchema), async (c) =>
    c.json(ok(await pauseGoal(services, c.req.valid("json").sessionId))),
  );
  router.post("/resume", jsonBody(sessionIdInputSchema), async (c) =>
    c.json(ok(await resumeGoal(services, c.req.valid("json").sessionId))),
  );
  router.post("/clear", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(clearGoal(services, c.req.valid("json").sessionId))),
  );

  return router;
};
