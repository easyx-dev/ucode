/**
 * 会话标题服务：投递首轮输入时并行生成标题，失败时在落定边界用完整交流补一次。
 *
 * 并行那条路只喂用户提问，与这一轮对话同时跑，新会话在侧栏里尽早有名字（原先要等整轮跑完才出现）。
 * 落定兜底只在并行那次没有产出时启用——标题是纯后台动作，失败只记日志，
 * 列表始终留着派生的标题口径可回落，不值得每次落定都白跑一次模型。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";

import type { SessionEventBus } from "../../../core/event-bus";
import type { SessionRepository } from "../../../db/session-repository";
import { logger } from "../../../platform/logger";
import { firstExchange, firstPromptExchange, generateSessionTitle, isFirstTurn } from "./generate";

export type TitleServiceDeps = {
  sessions: SessionRepository;
  events: SessionEventBus;
  /** 池内会话：标题要读它的模型与消息，写回也要用它的会话文件 */
  liveOf: (sessionId: string) => AgentSession | undefined;
  /** 写回名字后重新下发摘要，让各端侧栏同步 */
  emitSummary: (sessionId: string) => void;
};

export class TitleService {
  /** 在途生成：同一次边界上的重复触发不重复调用模型 */
  private readonly generating = new Set<string>();
  /** 并行那次没产出标题的会话：落定后再用完整交流兜底一次 */
  private readonly retryable = new Set<string>();

  constructor(private readonly deps: TitleServiceDeps) {
    this.deps.events.subscribe((frame) => {
      if (frame.type !== "agent_settled") return;
      // 并行那次还在跑就让它自己收尾，它成功后会清掉待补标记
      if (!this.retryable.has(frame.sessionId) || this.generating.has(frame.sessionId)) return;
      const session = this.deps.liveOf(frame.sessionId);
      if (session) this.generate(frame.sessionId, session);
    });
  }

  /**
   * 投递首轮输入时并行起标题：只喂用户提问，与这一轮同时跑。
   * 由投递路径在本轮开始前调用；是否首轮、是否该由我们命名都由这里判断。
   */
  generateForPrompt(sessionId: string, session: AgentSession, userText: string): void {
    if (!this.canGenerate(sessionId) || !isFirstTurn(session.messages)) return;
    const model = session.model;
    if (!model) return;

    this.retryable.add(sessionId);
    this.run(sessionId, session, model, firstPromptExchange(userText));
  }

  /** 落定兜底：并行那次失败或没产出时，用完整的首条交流再试一次 */
  private generate(sessionId: string, session: AgentSession): void {
    // 只补一次：无论能否生成都先清掉待补标记，避免会话归档后该 id 常驻
    this.retryable.delete(sessionId);
    if (!this.canGenerate(sessionId)) return;
    const model = session.model;
    if (!model) return;
    const exchange = firstExchange(session.messages);
    if (!exchange) return;

    this.run(sessionId, session, model, exchange);
  }

  /** 前置条件：不在途、会话仍存在且未被删除、不是子会话、用户还没自己命名 */
  private canGenerate(sessionId: string): boolean {
    if (this.generating.has(sessionId)) return false;
    const record = this.deps.sessions.find(sessionId);
    return Boolean(record && !record.deletedAt && !record.parentSessionId && !record.name);
  }

  /** 异步生成：不 await 调用方 */
  private run(
    sessionId: string,
    session: AgentSession,
    model: NonNullable<AgentSession["model"]>,
    exchange: Parameters<typeof generateSessionTitle>[0]["exchange"],
  ): void {
    this.generating.add(sessionId);
    void generateSessionTitle({ runtime: session.modelRuntime, model, exchange })
      .then((title) => {
        if (!title) {
          // 模型没给出可用标题（空输出 / 解析失败）：留痕，不然这类失败在界面上完全看不出来
          logger.warn({ sessionId }, "会话标题未产出，继续用派生的标题口径");
          return;
        }
        this.retryable.delete(sessionId);
        this.apply(sessionId, session, title);
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
