/**
 * 会话标题服务：首条消息得到回复后异步生成一条标题并写回会话名。
 *
 * 触发点在事件总线的 `agent_settled`（与池里的落定钩子同一个 pi 事件）——订阅事件让标题生成
 * 与会话池解耦，池不必认识它。生成是纯后台动作：不阻塞对话、失败只记日志，
 * 列表始终留着派生的标题口径可回落。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { SessionEventBus } from "../../core/event-bus";
import type { SessionRepository } from "../../db/session-repository";
import { logger } from "../../lib/logger";
import { firstExchange, generateSessionTitle } from "./generate";

export type TitleServiceDeps = {
  sessions: SessionRepository;
  events: SessionEventBus;
  /** 池内会话：标题要读它的模型与消息，写回也要用它的会话文件 */
  liveOf: (sessionId: string) => AgentSession | undefined;
  /** 写回名字后重新下发摘要，让各端侧栏同步 */
  emitSummary: (sessionId: string) => void;
};

export class TitleService {
  /** 在途生成：同一次落定边界上的重复触发不重复调用模型 */
  private readonly generating = new Set<string>();

  constructor(private readonly deps: TitleServiceDeps) {
    this.deps.events.subscribe((frame) => {
      if (frame.type !== "agent_settled") return;
      const session = this.deps.liveOf(frame.sessionId);
      if (session) this.generate(frame.sessionId, session);
    });
  }

  /** 异步生成：不 await 调用方 */
  private generate(sessionId: string, session: AgentSession): void {
    if (this.generating.has(sessionId)) return;
    const record = this.deps.sessions.find(sessionId);
    // 子会话的名字是任务简称、用户命名优先，都不覆盖
    if (!record || record.deletedAt || record.parentSessionId || record.name) return;
    const model = session.model;
    if (!model) return;
    const exchange = firstExchange(session.messages);
    if (!exchange) return;

    this.generating.add(sessionId);
    void generateSessionTitle({ runtime: session.modelRuntime, model, exchange })
      .then((title) => {
        if (title) this.apply(sessionId, session, title);
      })
      .catch((error: unknown) => logger.warn({ sessionId, error }, "会话标题生成失败"))
      .finally(() => this.generating.delete(sessionId));
  }

  /** 写回：先落库再补一帧摘要；会话文件在实例仍持有时同时追加 */
  private apply(sessionId: string, session: AgentSession, title: string): void {
    const record = this.deps.sessions.find(sessionId);
    // 生成期间用户自己命名过：用户的名字优先
    if (!record || record.name) return;

    // 只往池内那一个 manager 追加：另开一个会与它各持叶子，在会话文件里写出旁支
    // 实例已被回收时只写库——列表与详情读的都是库里的名字
    if (this.deps.liveOf(sessionId) === session) {
      try {
        session.sessionManager.appendSessionInfo(title);
      } catch (error) {
        logger.warn({ sessionId, error }, "会话标题写入会话文件失败");
      }
    }
    this.deps.sessions.set(sessionId, { name: title });
    this.deps.emitSummary(sessionId);
  }
}
