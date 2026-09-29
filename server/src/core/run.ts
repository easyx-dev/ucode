/** 会话运行：把一条输入投递给会话，生成在服务端后台推进，结果走事件总线 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES, type PromptInput } from "@ucode/contracts";

import type { Services } from "../app";
import { AppError } from "../lib/response";
import { sleep } from "../utils/time";

/** 等占位的 run 真正进入 streaming（prompt 内部还有鉴权等异步步骤） */
const waitForBusy = async (
  session: AgentSession,
  isRunning: () => boolean,
  timeoutMs = 3000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (session.isStreaming) return true;
    if (!isRunning()) return false;
    await sleep(25);
  }
  return session.isStreaming;
};

/** 后台失败只能通过事件流回传，调用方连接此时可能早已断开 */
const report = (services: Services, sessionId: string, error: unknown): void => {
  const code = error instanceof AppError ? error.code : ERROR_CODES.internal;
  const message = error instanceof Error ? error.message : String(error);
  services.events.emitError(sessionId, code, message);
};

/**
 * 开一轮后台生成：立即返回，不 await。
 * 这正是「刷新后仍能看到输出」的前提——run 的所有权在服务端，不在请求连接上。
 */
const startRun = (
  services: Services,
  sessionId: string,
  session: AgentSession,
  text: string,
): void => {
  if (!services.pool.beginRun(sessionId)) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正忙，请稍后重试或改用 steer", 409);
  }
  void session
    .prompt(text)
    .catch((error) => report(services, sessionId, error))
    .finally(() => services.pool.endRun(sessionId));
};

/**
 * 受理一条输入：空闲则开新一轮并立即返回，生成中则按 behavior 排队。
 * 只 await「取会话」与「入队」这类短操作，不 await 整轮生成。
 */
export const admitPrompt = async (services: Services, input: PromptInput): Promise<void> => {
  const { sessionId, text, behavior, cwd } = input;

  // 只在「创建/取回 AgentSession」这段加锁；run 本身不占锁，
  // 否则并发请求会一直排队到上一轮结束，steer / follow-up 永远不会生效。
  const session = await services.pool.withLock(sessionId, () =>
    services.pool.ensure(sessionId, cwd),
  );

  if (!services.pool.isRunning(sessionId) && !session.isStreaming) {
    startRun(services, sessionId, session, text);
    return;
  }

  if (await waitForBusy(session, () => services.pool.isRunning(sessionId))) {
    if (behavior === "steer") await session.steer(text);
    else await session.followUp(text);
    return;
  }

  // 占位者已经结束（可能失败）：退化成新的一轮
  startRun(services, sessionId, session, text);
};
