/**
 * 交互中转：服务端挂起一条请求，前端回答后才继续。
 *
 * 这是「服务端提问、前端回答」的通用原语，承载两类请求：权限审批（`ask` 规则）与
 * question 工具（模型向用户提问）。请求不落盘：刷新 / 重连后由 `interactions/list` 补齐。
 *
 * 待答请求只在进程内存；超时按各 kind 的失败姿态结算（审批按 `deny`，提问给 `timeout`），
 * 本轮中断 / 会话删除给 `cancelled`，工具调用不会悬空。
 */
import { randomUUID } from "node:crypto";

import type {
  InteractionRespondInput,
  InteractionRespondResponse,
  PendingInteraction,
  PermissionDecision,
  PermissionInteraction,
  QuestionInteraction,
  QuestionItem,
} from "@ucode/contracts";
import { PERMISSION_APPROVAL_TIMEOUT_MS, QUESTION_TIMEOUT_MS } from "../constants";
import type { PermissionAsk } from "../harness/permissions";
import type { SessionEventBus } from "./event-bus";

/** question 的结算结果：用户答复 / 等待超时 / 本轮中断或会话关闭 */
export type QuestionAnswerResult =
  | { kind: "answered"; answers: string[][] }
  | { kind: "timeout" }
  | { kind: "cancelled" };

type FailureReason = "timeout" | "cancelled";

/** 请求来源：由子会话触发时标注，父会话前端据此提示「来自子智能体」 */
export type InteractionSource = {
  sourceSessionId: string;
  sourceDescription: string;
};

type Pending = {
  request: PendingInteraction;
  timer: NodeJS.Timeout;
  /** 用户答复；kind 与 request 一致（respond 已校验） */
  respond: (input: InteractionRespondInput) => void;
  /** 无人答复时的结算：审批一律拒绝，提问按原因区分超时 / 取消 */
  fail: (reason: FailureReason) => void;
};

export class InteractionBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly events: SessionEventBus,
    private readonly timeoutMs = PERMISSION_APPROVAL_TIMEOUT_MS,
    private readonly questionTimeoutMs = QUESTION_TIMEOUT_MS,
  ) {}

  /** 权限审批：挂起并向事件流发一条请求，返回用户答复（超时 / 断连为 `deny`） */
  requestPermission(
    sessionId: string,
    ask: PermissionAsk,
    source?: InteractionSource,
  ): Promise<PermissionDecision> {
    const request: PermissionInteraction = {
      requestId: randomUUID(),
      kind: "permission",
      sessionId,
      tool: ask.tool,
      subject: ask.subject,
      scope: ask.scope,
      ...(source ?? {}),
      createdAt: new Date().toISOString(),
    };

    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.settle(request.requestId, (entry) => entry.fail("timeout"));
      }, this.timeoutMs);
      timer.unref();

      this.pending.set(request.requestId, {
        request,
        timer,
        respond: (input) => {
          if (input.kind === "permission") resolve(input.decision);
        },
        fail: () => resolve("deny"),
      });
      this.events.emitFrame(sessionId, "interaction_request", request);
    });
  }

  /**
   * question 工具：挂起并向事件流发一条提问，返回用户答复。
   * `signal` 是本轮工具调用的中断信号，中断即取消挂起请求（表现为 `cancelled`）。
   */
  requestQuestion(
    sessionId: string,
    questions: QuestionItem[],
    signal?: AbortSignal,
    source?: InteractionSource,
  ): Promise<QuestionAnswerResult> {
    if (signal?.aborted) return Promise.resolve({ kind: "cancelled" });

    const request: QuestionInteraction = {
      requestId: randomUUID(),
      kind: "question",
      sessionId,
      questions,
      ...(source ?? {}),
      createdAt: new Date().toISOString(),
    };

    return new Promise<QuestionAnswerResult>((resolve) => {
      const onAbort = (): void => {
        this.settle(request.requestId, (entry) => entry.fail("cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        this.settle(request.requestId, (entry) => entry.fail("timeout"));
      }, this.questionTimeoutMs);
      timer.unref();

      this.pending.set(request.requestId, {
        request,
        timer,
        respond: (input) => {
          if (input.kind !== "question") return;
          signal?.removeEventListener("abort", onAbort);
          resolve({ kind: "answered", answers: input.answers });
        },
        fail: (reason) => {
          signal?.removeEventListener("abort", onAbort);
          resolve({ kind: reason });
        },
      });
      this.events.emitFrame(sessionId, "interaction_request", request);
    });
  }

  /** 前端回答：命中挂起请求且 kind 一致则结算并广播 resolved */
  respond(input: InteractionRespondInput): InteractionRespondResponse {
    const entry = this.pending.get(input.requestId);
    // kind 不一致说明前端答错了请求形状，保留原请求而不是误结算
    if (!entry || entry.request.kind !== input.kind) {
      return { requestId: input.requestId, resolved: false };
    }
    return {
      requestId: input.requestId,
      resolved: this.settle(input.requestId, (pending) => pending.respond(input)),
    };
  }

  /** 某会话尚未回答的请求；刷新 / 重连后补齐对话框 */
  list(sessionId: string): PendingInteraction[] {
    return [...this.pending.values()]
      .map((entry) => entry.request)
      .filter((request) => request.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** 会话删除 / 回收时清理：挂起请求按失败结算，避免工具调用悬空 */
  forget(sessionId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.request.sessionId === sessionId) {
        this.settle(requestId, (pending) => pending.fail("cancelled"));
      }
    }
  }

  /**
   * 结算某个来源子会话发起的挂起请求：请求挂在父会话下（`sessionId`），
   * 按 `sourceSessionId` 只清该子会话的来源，父会话自身的请求不受影响。
   */
  forgetSource(sessionId: string, sourceSessionId: string): void {
    for (const requestId of [...this.pending.keys()]) {
      const request = this.pending.get(requestId)?.request;
      if (request?.sessionId !== sessionId || request.sourceSessionId !== sourceSessionId) continue;
      this.settle(requestId, (pending) => pending.fail("cancelled"));
    }
  }

  private settle(requestId: string, apply: (entry: Pending) => void): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    apply(entry);
    this.events.emitFrame(entry.request.sessionId, "interaction_resolved", { requestId });
    return true;
  }
}
