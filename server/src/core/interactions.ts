/**
 * 交互中转：服务端挂起一条请求，前端回答后才继续。
 *
 * 这是「服务端提问、前端回答」的通用原语——阶段 2 只服务权限审批，
 * 后续的 question 双向通道复用同一套（pending 注册表 + `interaction_request` 事件 +
 * `interactions/respond` 接口）。请求不落盘：刷新 / 重连后由 `interactions/list` 补齐。
 *
 * 当前待答请求只在进程内存，超时即按拒绝结算；会话删除时统一拒绝并清理。
 */
import { randomUUID } from "node:crypto";

import type {
  InteractionRespondInput,
  InteractionRespondResponse,
  PendingInteraction,
  PermissionDecision,
} from "@ucode/contracts";

import type { PermissionAsk } from "../agent/permissions";
import { PERMISSION_APPROVAL_TIMEOUT_MS } from "../constants";
import type { SessionEventBus } from "./event-bus";

type Pending = {
  request: PendingInteraction;
  settle: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
};

export class InteractionBroker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly events: SessionEventBus,
    private readonly timeoutMs = PERMISSION_APPROVAL_TIMEOUT_MS,
  ) {}

  /** 权限审批：挂起并向事件流发一条请求，返回用户答复（超时 / 断连为 `deny`） */
  requestPermission(sessionId: string, ask: PermissionAsk): Promise<PermissionDecision> {
    const request: PendingInteraction = {
      requestId: randomUUID(),
      kind: "permission",
      sessionId,
      tool: ask.tool,
      subject: ask.subject,
      scope: ask.scope,
      createdAt: new Date().toISOString(),
    };

    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => this.settle(request.requestId, "deny"), this.timeoutMs);
      timer.unref();
      this.pending.set(request.requestId, { request, settle: resolve, timer });
      this.events.emitFrame(sessionId, "interaction_request", request);
    });
  }

  /** 前端回答：命中挂起请求则结算并广播 resolved */
  respond(input: InteractionRespondInput): InteractionRespondResponse {
    // 目前只有 permission 一种 kind；阶段 5 加 question 时 TypeScript 会在这里报错，提示补分支
    return { requestId: input.requestId, resolved: this.settle(input.requestId, input.decision) };
  }

  /** 某会话尚未回答的请求；刷新 / 重连后补齐对话框 */
  list(sessionId: string): PendingInteraction[] {
    return [...this.pending.values()]
      .map((entry) => entry.request)
      .filter((request) => request.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** 会话删除时清理：挂起的审批一律按拒绝结算，避免工具调用悬空 */
  forget(sessionId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.request.sessionId === sessionId) this.settle(requestId, "deny");
    }
  }

  private settle(requestId: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.settle(decision);
    this.events.emitFrame(entry.request.sessionId, "interaction_resolved", { requestId });
    return true;
  }
}
