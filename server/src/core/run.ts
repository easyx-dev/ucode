/** 会话运行：把一条输入投递给会话，生成在服务端后台推进，结果走事件总线 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES, type MessageEditInput, type PromptInput } from "@ucode/contracts";

import { resolveEditableUserEntry } from "../agent/edit";
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
  services.events.emitError(
    sessionId,
    code,
    message,
    error instanceof AppError ? error.params : undefined,
  );
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
    .finally(() => {
      services.pool.endRun(sessionId);
      // 生成落定后立即刷新 SQLite 索引，列表 / 详情不必再读 JSONL
      services.pool.refreshIndex(sessionId);
    });
};

/**
 * 受理一条输入：空闲则开新一轮并立即返回，生成中则按 behavior 排队。
 * 只 await「取会话」与「入队」这类短操作，不 await 整轮生成。
 */
export const admitPrompt = async (services: Services, input: PromptInput): Promise<void> => {
  const { sessionId, text, behavior } = input;

  // 会话必须先存在：查不到的 id 会一路走到「以会话工作目录当 cwd」的推导上，
  // 而那一步现在只认已有记录（见 `resolveSessionCwd`），这里提前给出明确的 404。
  if (!services.sessions.find(sessionId)) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }

  // 只在「创建/取回 AgentSession」这段加锁；run 本身不占锁，
  // 否则并发请求会一直排队到上一轮结束，steer / follow-up 永远不会生效。
  const session = await services.pool.withLock(sessionId, () => services.pool.ensure(sessionId));

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

/**
 * 编辑一条已发送的用户消息并重发：把活动分支移回该消息之前，再以新文本开一轮。
 *
 * 旧分支条目原样留在会话文件里（不删除、不总结），因此这一步不是「修改历史」而是「换一条分支继续」。
 * 与 prompt 不同，编辑不能在忙碌时排队——它改变的是本轮起点，必须等会话彻底空闲。
 */
export const admitEdit = async (services: Services, input: MessageEditInput): Promise<void> => {
  const { sessionId, entryId, text } = input;

  const record = services.sessions.find(sessionId);
  if (!record || record.deletedAt) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  // 子智能体会话只读、没有独立的重发语义
  if (record.parentSessionId || record.agent) {
    throw new AppError(ERROR_CODES.invalidRequest, "子智能体会话不支持编辑", 400);
  }

  // 编辑先改活动分支再开生成，整段决策必须在同一把锁内完成：
  // 否则并发编辑会各自通过空闲检查、重复 navigateTree，把叶子改乱。
  // startRun 只做占位、不占用锁，串行化的是决策点而不是整轮生成。
  await services.pool.withLock(sessionId, async () => {
    const session = await services.pool.ensure(sessionId);
    // 压缩 / 分支总结 / 重试 / 排队也算不空闲
    if (services.pool.isActive(sessionId) || !session.isIdle) {
      throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
    }

    resolveEditableUserEntry(session.sessionManager.getBranch(), entryId);
    try {
      await session.navigateTree(entryId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AppError(ERROR_CODES.invalidRequest, `编辑失败：${reason}`, 400);
    }

    // 活动分支已改变：让所有在线客户端丢弃本地历史、重新取快照
    services.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: entryId });
    startRun(services, sessionId, session, text);
  });
};
