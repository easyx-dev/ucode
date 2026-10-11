/**
 * 交互中转：服务端挂起一条请求，前端回答后才继续。
 *
 * 这是「服务端提问、前端回答」的通用原语，承载两类请求：权限审批（`ask` 规则）与
 * question 工具（模型向用户提问）。请求不落盘：刷新 / 重连后由 `interactions/list` 补齐；
 * 但结算结果会经 `record` 回调留一条会话记录（见 `INTERACTION_RECORD_CUSTOM_TYPE`）。
 *
 * 待答请求只在进程内存，且不设等待时限：结算只由用户答复、本轮中断（`stop`）与会话归档 / 回收触发，
 * 各 kind 按自己的失败姿态收尾（审批 `deny`、提问 `cancelled`），工具调用不会悬空。
 */
import { randomUUID } from "node:crypto";

import type {
  InteractionRecord,
  InteractionRespondInput,
  InteractionRespondResponse,
  PendingInteraction,
  PermissionDecision,
  PermissionInteraction,
  QuestionInteraction,
  QuestionItem,
} from "@ucode/contracts";
import type { PermissionAsk } from "../harness/setup/permissions";
import type { SessionEventBus } from "./event-bus";

/** question 的结算结果：用户答复 / 本轮中断或会话关闭 */
export type QuestionAnswerResult =
  | { kind: "answered"; answers: string[][] }
  | { kind: "cancelled" };

/**
 * 权限审批的结算结果。
 *
 * `byUser` 为假表示这次 `deny` 是中断 / 回收代打的，不是用户的选择——调用方据此决定要不要
 * 把它当成「用户拒绝」留痕（写成「已拒绝」会让事后回放读到错误结论）。
 */
export type PermissionOutcome = {
  decision: PermissionDecision;
  /** 是否由用户实际作答 */
  byUser: boolean;
};

/** 请求来源：由子会话触发时标注，父会话前端据此提示「来自子智能体」 */
export type InteractionSource = {
  sourceSessionId: string;
  sourceDescription: string;
};

type Pending = {
  request: PendingInteraction;
  /** 用户答复；kind 与 request 一致（respond 已校验） */
  respond: (input: InteractionRespondInput) => void;
  /** 无人答复时的结算：审批一律拒绝，提问按取消 */
  fail: () => void;
};

export class InteractionBroker {
  private readonly pending = new Map<string, Pending>();

  /**
   * `record` 是结算留痕的回调（写进会话文件）；挂在会话上的请求在结算后不再有任何痕迹，
   * 而「谁在什么时候把它撤了」正是事后回放要看的信息。省略时只做结算、不留痕。
   */
  constructor(
    private readonly events: SessionEventBus,
    private readonly record?: (input: {
      sessionId: string;
      request: PendingInteraction;
      outcome: InteractionRecord["outcome"];
    }) => void,
  ) {}

  /**
   * 权限审批：挂起并向事件流发一条请求，返回用户答复（本轮中断 / 会话清理为 `deny`）。
   *
   * 中断信号随 `ask.signal` 进来：它一到就按拒绝结算，否则 `stop` 会卡在 `beforeToolCall` 上不返回。
   */
  requestPermission(
    sessionId: string,
    ask: PermissionAsk,
    source?: InteractionSource,
  ): Promise<PermissionOutcome> {
    if (ask.signal?.aborted) return Promise.resolve({ decision: "deny", byUser: false });

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

    return new Promise<PermissionOutcome>((resolve) => {
      const detach = this.settleOnAbort(request.requestId, ask.signal);

      this.pending.set(request.requestId, {
        request,
        respond: (input) => {
          if (input.kind !== "permission") return;
          detach();
          resolve({ decision: input.decision, byUser: true });
        },
        fail: () => {
          detach();
          resolve({ decision: "deny", byUser: false });
        },
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
      const detach = this.settleOnAbort(request.requestId, signal);

      this.pending.set(request.requestId, {
        request,
        respond: (input) => {
          if (input.kind !== "question") return;
          detach();
          resolve({ kind: "answered", answers: input.answers });
        },
        fail: () => {
          detach();
          resolve({ kind: "cancelled" });
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
      resolved: this.settle(input.requestId, (pending) => pending.respond(input), "resolved"),
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
        this.settle(requestId, (pending) => pending.fail(), "dismissed");
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
      this.settle(requestId, (pending) => pending.fail(), "dismissed");
    }
  }

  /** 本轮中断即按失败结算挂起请求；返回解除监听的函数 */
  private settleOnAbort(requestId: string, signal?: AbortSignal): () => void {
    if (!signal) return () => {};
    const onAbort = (): void => {
      this.settle(requestId, (entry) => entry.fail(), "aborted");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }

  private settle(
    requestId: string,
    apply: (entry: Pending) => void,
    outcome: InteractionRecord["outcome"],
  ): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    apply(entry);
    this.events.emitFrame(entry.request.sessionId, "interaction_resolved", { requestId });
    this.record?.({ sessionId: entry.request.sessionId, request: entry.request, outcome });
    return true;
  }
}
