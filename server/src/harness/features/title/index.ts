/**
 * 会话标题服务：投递首轮输入时并行生成标题，之后每轮落定再补，直到产出或达到尝试上限。
 *
 * 并行那条路只喂用户提问，与这一轮对话同时跑，新会话在侧栏里尽早有名字（原先要等整轮跑完才出现）。
 * 没产出就在落定边界上用完整交流再问：模型给的标题时有不合规的（多行、带前缀、把回答当标题），
 * 所以补试不是一个「兜底一次」而是有上限的重试（见 `TITLE_MAX_ATTEMPTS`）。
 * 标题始终是纯后台动作，失败只记日志，列表留着用户命名口径可回落。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { TITLE_MAX_ATTEMPTS } from "../../../constants/title";
import type { SessionEventBus } from "../../../core/event-bus";
import type { SessionRepository } from "../../../db/session-repository";
import { logger } from "../../../platform/logger";
import {
  firstExchange,
  firstPromptExchange,
  generateSessionTitle,
  isFirstTurn,
  isTitleWindowOpen,
  type TitleExchange,
} from "./generate";

export type TitleServiceDeps = {
  sessions: SessionRepository;
  events: SessionEventBus;
  /** 池内会话：标题要读它的模型与消息，写回也要用它的会话文件 */
  liveOf: (sessionId: string) => AgentSession | undefined;
  /** 写回名字后重新下发摘要，让各端侧栏同步 */
  emitSummary: (sessionId: string) => void;
};

/** 一个待命名的会话：已用掉的尝试次数、投递时那句提问、以及本次尝试期间是否已经落定过 */
type PendingTitle = {
  attempts: number;
  /**
   * 拿不到完整交流（首轮被中断、回复里只有工具调用）时的料。
   * 存的是已按预算截断的那份：这条会在「失败且没再落定」的会话上留到进程退出，
   * 不该把整段提问一直带着。
   */
  promptText: string;
  /**
   * 本次尝试在途时就落定过。它保证「并行那次跑得比首轮慢」不会把重试机会丢掉：
   * 收尾时看到这个标记就自己接着再试一次，而不必等下一轮。
   */
  settleSeen: boolean;
};

export class TitleService {
  /** 在途生成：同一次边界上的重复触发不重复调用模型 */
  private readonly generating = new Set<string>();
  /** 待命名的会话（按 id）：成功、超窗或不再可命名时移除 */
  private readonly pending = new Map<string, PendingTitle>();

  constructor(private readonly deps: TitleServiceDeps) {
    this.deps.events.subscribe((frame) => {
      if (frame.type !== "agent_settled") return;
      const entry = this.pending.get(frame.sessionId);
      if (!entry) return;
      // 并行那次还在跑就让它自己收尾
      if (this.generating.has(frame.sessionId)) {
        entry.settleSeen = true;
        return;
      }
      const session = this.deps.liveOf(frame.sessionId);
      // 会话已被回收（归档 / 删除）：这条待命名不再有意义，清掉避免 id 常驻
      if (!session) {
        this.pending.delete(frame.sessionId);
        return;
      }
      this.retry(frame.sessionId, session, entry);
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

    const prompt = firstPromptExchange(userText);
    const entry: PendingTitle = { attempts: 0, promptText: prompt.userText, settleSeen: false };
    this.pending.set(sessionId, entry);
    this.attempt(sessionId, session, model, prompt, entry);
  }

  /**
   * 落定边界上的补试。料优先取完整交流，为空且仍在可命名窗口内时回落投递时那句——
   * 首轮被中断（回复里没有正文）时只有它可用。
   */
  private retry(sessionId: string, session: AgentSession, entry: PendingTitle): void {
    const model = session.model;
    if (entry.attempts >= TITLE_MAX_ATTEMPTS || !this.canGenerate(sessionId) || !model) {
      this.pending.delete(sessionId);
      return;
    }
    const exchange = this.exchangeOf(session, entry);
    // 超出可命名窗口（会话已经不是「一件事」）：不再尝试，也不必留着这条
    if (!exchange) {
      this.pending.delete(sessionId);
      return;
    }
    this.attempt(sessionId, session, model, exchange, entry);
  }

  private exchangeOf(session: AgentSession, entry: PendingTitle): TitleExchange | null {
    const exchange = firstExchange(session.messages);
    if (exchange) return exchange;
    return isTitleWindowOpen(session.messages) ? firstPromptExchange(entry.promptText) : null;
  }

  /** 前置条件：不在途、会话仍存在且未被删除、不是子会话、用户还没自己命名 */
  private canGenerate(sessionId: string): boolean {
    if (this.generating.has(sessionId)) return false;
    const record = this.deps.sessions.find(sessionId);
    return Boolean(record && !record.deletedAt && !record.parentSessionId && !record.name);
  }

  /** 异步生成：不 await 调用方 */
  private attempt(
    sessionId: string,
    session: AgentSession,
    model: NonNullable<AgentSession["model"]>,
    exchange: TitleExchange,
    entry: PendingTitle,
  ): void {
    entry.attempts += 1;
    // 这次尝试自己会收尾：先把落定标记消费掉，收尾时没有新标记就不再续跑
    entry.settleSeen = false;
    const isRetry = entry.attempts > 1;
    this.generating.add(sessionId);
    void generateSessionTitle({ runtime: session.modelRuntime, model, exchange, retry: isRetry })
      .then((title) => {
        if (!title) {
          // 模型没给出可用标题（空输出 / 解析失败）：留痕，不然这类失败在界面上完全看不出来
          logger.warn(
            { sessionId, attempt: entry.attempts, max: TITLE_MAX_ATTEMPTS },
            "会话标题未产出",
          );
          return;
        }
        this.pending.delete(sessionId);
        this.apply(sessionId, session, title);
      })
      .catch((error: unknown) =>
        logger.warn({ sessionId, attempt: entry.attempts, error }, "会话标题生成失败"),
      )
      .finally(() => {
        this.generating.delete(sessionId);
        // 刚才那次还在跑时落定过：紧接着再试一次，别把这次触发浪费掉
        if (entry.settleSeen) this.retry(sessionId, session, entry);
      });
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
