/**
 * 目标模式的装配入口：状态读写、校验编排与止损判定。
 *
 * 目标是会话属性（见 plans/stage-11-goal.md）：只叠加在 `build` 模式上，不改变工具集与权限。
 * 自动续跑由会话池在 `agent_settled` 时驱动：`onSettled` 只负责判定与改状态，
 * 需要续跑时把下一轮文本交回给池去投递（不反向依赖池）。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  GOAL_RECORD_CUSTOM_TYPE,
  type GoalPauseCause,
  type GoalRecord,
  type GoalView,
} from "@ucode/contracts";

import { GOAL_MAX_TURNS, GOAL_NO_PROGRESS_TURNS, GOAL_VERIFY_USAGE_KIND } from "../../constants";
import type { SessionEventBus } from "../../core/event-bus";
import type { SessionRecord, SessionRepository } from "../../db/session-repository";
import { logger } from "../../lib/logger";
import type { UsageService } from "../usage";
import { buildGoalContinuation } from "./prompt";
import {
  advanceTurn,
  completeGoal,
  type GoalState,
  parseGoalState,
  pauseGoal,
  recordVerification,
  resumeGoal,
  serializeGoalState,
  startGoal,
} from "./state";
import {
  collectGoalEvidence,
  type GoalVerifyUsage,
  lastAssistantActivity,
  lastAssistantStopReason,
  runGoalVerification,
} from "./verify";

export type GoalSetInput = {
  objective: string;
  tokenBudget: number | null;
};

/** 落定处理结果：`continue` 为下一轮注入的内容与轮次，null 表示不续跑 */
export type GoalSettleOutcome = { continue: { content: string; turn: number } } | null;

export class GoalService {
  /** 正在跑校验的会话；避免同一会话并发校验 */
  private readonly verifying = new Set<string>();

  constructor(
    private readonly sessions: SessionRepository,
    private readonly usage: UsageService,
    private readonly events: SessionEventBus,
  ) {}

  /** 存储状态 → 前端视图（补 `tokensUsed`）；无目标时返回 null */
  view(record: SessionRecord, live?: AgentSession): GoalView | null {
    const state = parseGoalState(record.goalState);
    return state ? this.toView(state, record, live) : null;
  }

  /** 设定 / 替换目标：重置计数与校验结果 */
  set(record: SessionRecord, input: GoalSetInput, live?: AgentSession): GoalView {
    return this.persist(record, startGoal(input.objective, input.tokenBudget), live, {
      event: "set",
      objective: input.objective,
    });
  }

  /** 暂停；只有 `active` 才生效 */
  pause(record: SessionRecord, cause: GoalPauseCause, live?: AgentSession): GoalView | null {
    const state = parseGoalState(record.goalState);
    if (state?.status !== "active") return this.view(record, live);
    return this.persist(record, pauseGoal(state, cause), live, { event: "pause", cause });
  }

  /**
   * 恢复；只有 `paused` 才生效。
   * 无进展计数归零，本轮起点回填成当前累计用量——纯状态机不知道用量，只能在这里补。
   */
  resume(record: SessionRecord, live?: AgentSession): GoalView | null {
    const state = parseGoalState(record.goalState);
    if (state?.status !== "paused") return this.view(record, live);
    return this.persist(
      record,
      { ...resumeGoal(state), tokensAtTurnStart: this.tokensUsed(state, record, live) },
      live,
      { event: "resume" },
    );
  }

  /** 只改 token 预算（不动轮数 / 校验结果 / 身份 id）；无目标时返回 null */
  setBudget(
    record: SessionRecord,
    tokenBudget: number | null,
    live?: AgentSession,
  ): GoalView | null {
    const state = parseGoalState(record.goalState);
    if (!state) return null;
    return this.persist(
      record,
      { ...state, tokenBudget, updatedAt: new Date().toISOString() },
      live,
      { event: "budget" },
    );
  }

  /**
   * 模型侧报告目标达成（`goal_complete` 工具）：状态守卫在 `onSettled` 之前短路，
   * 这一轮不再跑校验。非 `active` 时只回视图（迟到的工具调用不重复结算）。
   */
  completeByModel(record: SessionRecord, summary: string, live?: AgentSession): GoalView | null {
    const state = parseGoalState(record.goalState);
    if (state?.status !== "active") return this.view(record, live);
    const now = new Date().toISOString();
    const tokensUsed = this.tokensUsed(state, record, live);
    const view = this.persist(
      record,
      completeGoal(state, { achieved: true, reason: summary, nextStep: "", at: now }, now),
      live,
      {
        event: "completed",
        verdict: { achieved: true, reason: summary, nextStep: "" },
        tokensUsed,
        ...this.turnMetrics(state, live, tokensUsed, now),
      },
    );
    // 目标完成会在对话里留一条线，界面得重取快照才看得见
    this.events.emitFrame(record.id, "transcript_reset", { fromEntryId: "" });
    return view;
  }

  /** 模型侧报告受阻（`goal_blocked` 工具）：按 `blocked` 暂停，原因写进校验结论供回看 */
  blockByModel(record: SessionRecord, reason: string, live?: AgentSession): GoalView | null {
    const state = parseGoalState(record.goalState);
    if (state?.status !== "active") return this.view(record, live);
    const now = new Date().toISOString();
    const tokensUsed = this.tokensUsed(state, record, live);
    const text = reason.trim();
    return this.persist(record, pauseGoal(state, "blocked", now), live, {
      event: "pause",
      cause: "blocked",
      tokensUsed,
      ...(text ? { verdict: { achieved: false, reason: text, nextStep: "" } } : {}),
      ...this.turnMetrics(state, live, tokensUsed, now),
    });
  }

  /** 清除目标；不中断当前轮 */
  clear(record: SessionRecord, live?: AgentSession): void {
    this.sessions.setGoal(record.id, null);
    this.recordGoal(record, live, { event: "clear" });
    this.events.emitFrame(record.id, "goal_update", null);
  }

  /** 会话回收时丢弃在途标记；已在途的校验会自然跑完 */
  forget(sessionId: string): void {
    this.verifying.delete(sessionId);
  }

  /**
   * 一轮落定后的处理：被中断 / 出错则暂停，否则校验并决定是否续跑。
   * 只处理主会话的 build 模式；子会话、无目标、非 active 一律不做。
   *
   * 校验是一次网络调用，期间目标可能被替换 / 暂停 / 清除，所以返回后必须重新确认
   * 「状态仍 active 且身份 id 未变」才写回，否则丢弃这次结果。
   */
  async onSettled(sessionId: string, session: AgentSession): Promise<GoalSettleOutcome> {
    const record = this.sessions.find(sessionId);
    if (!record || record.parentSessionId || record.agent) return null;
    const state = parseGoalState(record.goalState);
    if (state?.status !== "active") return null;
    if (record.mode !== "build") return null;
    if (this.verifying.has(sessionId)) return null;

    const stopReason = lastAssistantStopReason(session.messages);
    if (stopReason === "aborted" || stopReason === "error") {
      const cause = stopReason === "aborted" ? "interrupted" : "error";
      this.persist(record, pauseGoal(state, cause), session, { event: "pause", cause });
      return null;
    }

    const model = session.model;
    if (!model) return null;

    const activationId = state.id;
    this.verifying.add(sessionId);
    try {
      const evidence = collectGoalEvidence(session.messages);
      let outcome: Awaited<ReturnType<typeof runGoalVerification>>;
      try {
        outcome = await runGoalVerification({
          runtime: session.modelRuntime,
          model,
          objective: state.objective,
          evidence,
        });
      } catch (error) {
        logger.warn({ sessionId, error }, "目标校验调用失败");
        const current = this.activeStateOf(sessionId, activationId);
        if (current) {
          this.persist(record, pauseGoal(current, "error"), session, {
            event: "pause",
            cause: "error",
          });
        }
        return null;
      }

      // 这笔 token 无论结论是否被采用都已经花掉：先记账，之后的 tokensUsed 才算得上「含校验开销」
      this.recordVerificationUsage(session, outcome.usage);

      const current = this.activeStateOf(sessionId, activationId);
      if (!current) return null;

      const now = new Date().toISOString();
      const verdict = outcome.verdict;
      if (verdict?.achieved) {
        const achieved = {
          achieved: true,
          reason: verdict.reason,
          nextStep: verdict.nextStep,
          at: now,
        };
        const completed = completeGoal(current, achieved, now);
        const tokensUsed = this.tokensUsed(completed, record, session);
        const view = this.persist(record, completed, session, {
          event: "completed",
          verdict: { achieved: true, reason: verdict.reason, nextStep: verdict.nextStep },
          tokensUsed,
          ...this.turnMetrics(current, session, tokensUsed, now),
        });
        // 目标完成会在对话里留一条线，界面得重取快照才看得见
        if (view) this.events.emitFrame(sessionId, "transcript_reset", { fromEntryId: "" });
        return null;
      }

      // 未达成（解析失败同样按未达成）：先更新无进展计数与校验结果
      const activity = lastAssistantActivity(session.messages);
      const noProgress =
        activity.toolCalls > 0
          ? 0
          : activity.text.length === 0 || activity.text === current.lastText
            ? current.noProgress + 1
            : 1;
      let next = recordVerification(
        current,
        {
          achieved: false,
          reason: verdict?.reason ?? "校验输出无法解析，按未达成处理。",
          nextStep: verdict?.nextStep ?? "",
          at: now,
        },
        { noProgress, lastText: activity.text },
        now,
      );

      const tokensUsed = this.tokensUsed(next, record, session);
      // 每轮校验的结论都落一条：它花了一次模型调用，只留在下一轮注入里会被压缩抹掉
      this.recordGoal(record, session, {
        event: "verdict",
        turns: next.turns,
        verdict: {
          achieved: false,
          reason: next.verification?.reason ?? "",
          nextStep: next.verification?.nextStep ?? "",
        },
        tokensUsed,
        ...this.turnMetrics(current, session, tokensUsed, now),
      });
      if (next.tokenBudget !== null && tokensUsed >= next.tokenBudget) {
        this.persist(record, pauseGoal(next, "budget", now), session, {
          event: "pause",
          cause: "budget",
        });
        return null;
      }
      if (noProgress >= GOAL_NO_PROGRESS_TURNS) {
        this.persist(record, pauseGoal(next, "no_progress", now), session, {
          event: "pause",
          cause: "no_progress",
        });
        return null;
      }
      if (next.turns >= GOAL_MAX_TURNS) {
        this.persist(record, pauseGoal(next, "limit", now), session, {
          event: "pause",
          cause: "limit",
        });
        return null;
      }

      next = advanceTurn(next, tokensUsed, now);
      this.persist(record, next, session);
      return {
        continue: {
          content: buildGoalContinuation(next.objective, verdict?.nextStep ?? ""),
          turn: next.turns,
        },
      };
    } finally {
      this.verifying.delete(sessionId);
    }
  }

  /** 重读目标状态：仅当仍为 active 且身份 id 与给定值一致时返回，否则视为本次结果作废 */
  private activeStateOf(sessionId: string, activationId: string): GoalState | null {
    const state = parseGoalState(this.sessions.find(sessionId)?.goalState ?? null);
    return state?.status === "active" && state.id === activationId ? state : null;
  }

  /** 落库 + 发事件；返回补好 `tokensUsed` 的视图。`record` 是这次变迁要落的会话条目 */
  private persist(
    record: SessionRecord,
    state: GoalState,
    live?: AgentSession,
    entry?: Omit<GoalRecord, "at" | "status" | "turns">,
  ): GoalView {
    this.sessions.setGoal(record.id, serializeGoalState(state));
    if (entry) {
      this.recordGoal(record, live, {
        ...entry,
        status: state.status,
        turns: state.turns,
      });
    }
    const view = this.toView(state, record, live);
    this.events.emitFrame(record.id, "goal_update", view);
    return view;
  }

  /**
   * 把目标的状态变迁 / 校验结论落成扩展条目（best-effort）。
   *
   * 只在会话已装配时写：没有 manager 就拿不到会话文件，而这属于观测记录，不该为它去拉起会话。
   */
  private recordGoal(
    record: SessionRecord,
    live: AgentSession | undefined,
    payload: Omit<GoalRecord, "at" | "turns"> & { turns?: number },
  ): void {
    const manager = live?.sessionManager;
    if (!manager) return;
    try {
      manager.appendCustomEntry(GOAL_RECORD_CUSTOM_TYPE, {
        ...payload,
        at: new Date().toISOString(),
      });
    } catch (error) {
      logger.warn({ sessionId: record.id, error }, "写入目标记录失败");
    }
  }

  private toView(state: GoalState, record: SessionRecord, live?: AgentSession): GoalView {
    return {
      objective: state.objective,
      status: state.status,
      cause: state.cause,
      turns: state.turns,
      tokenBudget: state.tokenBudget,
      tokensUsed: this.tokensUsed(state, record, live),
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      verification: state.verification,
    };
  }

  private tokensUsed(state: GoalState, record: SessionRecord, live?: AgentSession): number {
    const sinceMs = Date.parse(state.startedAt);
    return this.usage.usageOf(record, {
      ...(live ? { live } : {}),
      ...(Number.isFinite(sinceMs) ? { sinceMs } : {}),
    }).totalTokens;
  }

  /**
   * 本轮的规模与耗时：用量增量按轮起点差算，工具调用数取最后一条 assistant 的调用数。
   * 耗时只在两个时间点都能解析时给——存量目标的 `turnStartedAt` 是空串。
   */
  private turnMetrics(
    state: GoalState,
    live: AgentSession | undefined,
    tokensUsed: number,
    now: string,
  ): Pick<GoalRecord, "turnTokens" | "turnToolCalls" | "turnMs"> {
    const startedMs = Date.parse(state.turnStartedAt);
    const nowMs = Date.parse(now);
    return {
      turnTokens: Math.max(0, tokensUsed - state.tokensAtTurnStart),
      turnToolCalls: live ? lastAssistantActivity(live.messages).toolCalls : 0,
      ...(Number.isFinite(startedMs) && Number.isFinite(nowMs) && nowMs >= startedMs
        ? { turnMs: nowMs - startedMs }
        : {}),
    };
  }

  /**
   * 校验调用的用量落成会话里的 `usage` 条目：它不经过模型回合，不记就既不进目标预算也不进全局统计。
   * 写盘失败不影响判定，故全程 best-effort。
   */
  private recordVerificationUsage(session: AgentSession, usage: GoalVerifyUsage | null): void {
    if (!usage) return;
    try {
      session.sessionManager.appendUsage(
        GOAL_VERIFY_USAGE_KIND,
        usage.provider,
        usage.model,
        usage.usage,
        "目标达成校验",
      );
    } catch (error) {
      logger.warn({ error }, "写入目标校验用量失败");
    }
  }
}
