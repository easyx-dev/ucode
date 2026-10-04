/**
 * 目标模式的装配入口：状态读写、校验编排与止损判定。
 *
 * 目标是会话属性（见 plans/stage-11-goal.md）：只叠加在 `build` 模式上，不改变工具集与权限。
 * 自动续跑由会话池在 `agent_settled` 时驱动：`onSettled` 只负责判定与改状态，
 * 需要续跑时把下一轮文本交回给池去投递（不反向依赖池）。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { GoalPauseCause, GoalView } from "@ucode/contracts";

import { GOAL_MAX_TURNS, GOAL_NO_PROGRESS_TURNS } from "../../constants";
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
  lastAssistantActivity,
  lastAssistantStopReason,
  runGoalVerification,
} from "./verify";

export type GoalSetInput = {
  objective: string;
  tokenBudget: number | null;
};

/** 落定处理结果：`continue` 为下一轮文本，null 表示不续跑 */
export type GoalSettleOutcome = { continue: string } | null;

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
    return this.persist(record, startGoal(input.objective, input.tokenBudget), live);
  }

  /** 暂停；只有 `active` 才生效 */
  pause(record: SessionRecord, cause: GoalPauseCause, live?: AgentSession): GoalView | null {
    const state = parseGoalState(record.goalState);
    if (state?.status !== "active") return this.view(record, live);
    return this.persist(record, pauseGoal(state, cause), live);
  }

  /** 恢复；只有 `paused` 才生效 */
  resume(record: SessionRecord, live?: AgentSession): GoalView | null {
    const state = parseGoalState(record.goalState);
    if (state?.status !== "paused") return this.view(record, live);
    return this.persist(record, resumeGoal(state), live);
  }

  /** 清除目标；不中断当前轮 */
  clear(record: SessionRecord): void {
    this.sessions.setGoal(record.id, null);
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
      this.persist(
        record,
        pauseGoal(state, stopReason === "aborted" ? "interrupted" : "error"),
        session,
      );
      return null;
    }

    const model = session.model;
    if (!model) return null;

    const activationId = state.id;
    this.verifying.add(sessionId);
    try {
      const evidence = collectGoalEvidence(session.messages);
      let verdict: Awaited<ReturnType<typeof runGoalVerification>>;
      try {
        verdict = await runGoalVerification({
          runtime: session.modelRuntime,
          model,
          objective: state.objective,
          evidence,
        });
      } catch (error) {
        logger.warn({ sessionId, error }, "目标校验调用失败");
        const current = this.activeStateOf(sessionId, activationId);
        if (current) this.persist(record, pauseGoal(current, "error"), session);
        return null;
      }

      const current = this.activeStateOf(sessionId, activationId);
      if (!current) return null;

      const now = new Date().toISOString();
      if (verdict?.achieved) {
        this.persist(
          record,
          completeGoal(
            current,
            { achieved: true, reason: verdict.reason, nextStep: verdict.nextStep, at: now },
            now,
          ),
          session,
        );
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
      if (next.tokenBudget !== null && tokensUsed >= next.tokenBudget) {
        this.persist(record, pauseGoal(next, "budget", now), session);
        return null;
      }
      if (noProgress >= GOAL_NO_PROGRESS_TURNS) {
        this.persist(record, pauseGoal(next, "no_progress", now), session);
        return null;
      }
      if (next.turns >= GOAL_MAX_TURNS) {
        this.persist(record, pauseGoal(next, "limit", now), session);
        return null;
      }

      next = advanceTurn(next, now);
      this.persist(record, next, session);
      return { continue: buildGoalContinuation(next.objective, verdict?.nextStep ?? "") };
    } finally {
      this.verifying.delete(sessionId);
    }
  }

  /** 重读目标状态：仅当仍为 active 且身份 id 与给定值一致时返回，否则视为本次结果作废 */
  private activeStateOf(sessionId: string, activationId: string): GoalState | null {
    const state = parseGoalState(this.sessions.find(sessionId)?.goalState ?? null);
    return state?.status === "active" && state.id === activationId ? state : null;
  }

  /** 落库 + 发事件；返回补好 `tokensUsed` 的视图 */
  private persist(record: SessionRecord, state: GoalState, live?: AgentSession): GoalView {
    this.sessions.setGoal(record.id, serializeGoalState(state));
    const view = this.toView(state, record, live);
    this.events.emitFrame(record.id, "goal_update", view);
    return view;
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
}
