import type { UiMethod, UiRequest, UiResponse } from "@ucode/protocol";
import { canRespondToInteraction, interactionPriority } from "../capability/trust.ts";
import type { AttachmentView, ServiceBus } from "../types.ts";

/**
 * 交互中转（spec §4.6、§2.6、§2.7）。
 *
 * 方向与命令面相反：**服务层发起、控制层应答**。两类可靠性要求完全不同——
 * 通知式可以丢，阻塞式不能丢也不能重复应答（丢一次权限确认会让 agent 永久挂起）。
 *
 * 路由规则（先按身份分，再按来历分）：
 * 1. 已认证的 attachment：广播——所有 attachment 都显示，首个应答生效，其余同步关闭；
 * 2. 未认证的 attachment：按通路来历排序，untrusted 不具应答权；
 * 3. 有已认证 attachment 时优先走第 1 条；只有没有时，才用第 2 条。
 */

export type InteractionOutcome =
  | { status: "answered"; value: string | boolean | null; responderId: string | null }
  | { status: "cancelled"; reason: "timeout" | "no-capacity" | "withdrawn" | "cancelled" };

export type InteractionRequestInput = {
  sessionId: string | null;
  method: UiMethod;
  params: UiRequest["params"];
  origin: UiRequest["origin"];
  timeoutMs?: number;
};

type Pending = {
  request: UiRequest;
  responders: string[];
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (outcome: InteractionOutcome) => void;
};

export type UiBrokerOptions = {
  bus: ServiceBus;
  defaultTimeoutMs: number;
  /** 没有任何 attachment 能承载时的处置（降级，spec §2.7）。 */
  onNoCapacity?: (request: UiRequest) => void;
};

export class UiBroker {
  readonly #bus: ServiceBus;
  readonly #defaultTimeoutMs: number;
  readonly #onNoCapacity: ((request: UiRequest) => void) | undefined;
  readonly #pending = new Map<string, Pending>();
  #counter = 0;

  constructor(options: UiBrokerOptions) {
    this.#bus = options.bus;
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
    this.#onNoCapacity = options.onNoCapacity;
  }

  /** 待决交互数：>0 表示这个会话在等人（无人值守下据此决定是否通知用户）。 */
  pendingCount(sessionId: string | null): number {
    if (sessionId === null) return this.#pending.size;
    let count = 0;
    for (const pending of this.#pending.values()) {
      if (pending.request.sessionId === sessionId && !pending.settled) count += 1;
    }
    return count;
  }

  /** 这条连接上还有哪些请求没被应答（连接断开时要收尾）。 */
  pendingForConnection(connectionId: string): string[] {
    const ids: string[] = [];
    for (const [id, pending] of this.#pending) {
      if (pending.responders.includes(connectionId) && !pending.settled) ids.push(id);
    }
    return ids;
  }

  request(input: InteractionRequestInput): Promise<InteractionOutcome> {
    const id = `ui-${++this.#counter}`;
    const request: UiRequest = {
      type: "ui.request",
      id,
      sessionId: input.sessionId,
      method: input.method,
      params: input.params,
      origin: input.origin,
    };

    const responders = this.#respondersFor(input.sessionId);
    if (responders.length === 0) {
      // 没有可承载交互的 attachment：请求**不应发出**，直接走降级（spec §4.6）。
      this.#onNoCapacity?.(request);
      return Promise.resolve({ status: "cancelled", reason: "no-capacity" });
    }

    const timeoutMs =
      input.timeoutMs ??
      ("timeoutMs" in input.params && input.params.timeoutMs !== undefined
        ? input.params.timeoutMs
        : this.#defaultTimeoutMs);

    return new Promise<InteractionOutcome>((resolve) => {
      const pending: Pending = {
        request,
        responders: responders.map((attachment) => attachment.connectionId),
        settled: false,
        resolve,
      };
      this.#pending.set(id, pending);

      // 广播：多个 attachment 是同一个会话的多个视图，没有理由不同步。
      for (const connectionId of pending.responders) {
        this.#bus.sendTo(connectionId, request);
      }

      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.#settle(id, { status: "cancelled", reason: "timeout" }, "timeout");
        }, timeoutMs);
      }
    });
  }

  /** 控制层应答：首个应答生效，其余同步关闭。 */
  handleResponse(connectionId: string, response: UiResponse): InteractionOutcome | undefined {
    const pending = this.#pending.get(response.id);
    if (pending === undefined || pending.settled) return undefined; // 重复应答被忽略
    if (!pending.responders.includes(connectionId)) return undefined; // 不具应答权
    const outcome: InteractionOutcome =
      response.cancelled === true
        ? { status: "cancelled", reason: "cancelled" }
        : { status: "answered", value: response.value ?? null, responderId: connectionId };
    this.#settle(response.id, outcome, outcome.status === "answered" ? "answered" : "withdrawn");
    return outcome;
  }

  /** 连接断开：它在等的请求按"撤回"处置（否则发起方会等到超时）。 */
  withdrawForConnection(connectionId: string): void {
    for (const id of this.pendingForConnection(connectionId)) {
      const pending = this.#pending.get(id);
      if (pending === undefined) continue;
      pending.responders = pending.responders.filter((candidate) => candidate !== connectionId);
      if (pending.responders.length === 0) {
        this.#settle(id, { status: "cancelled", reason: "withdrawn" }, "withdrawn");
      }
    }
  }

  #settle(
    id: string,
    outcome: InteractionOutcome,
    reason: "answered" | "timeout" | "withdrawn",
  ): void {
    const pending = this.#pending.get(id);
    if (pending === undefined || pending.settled) return;
    pending.settled = true;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    this.#pending.delete(id);
    for (const connectionId of pending.responders) {
      if (
        reason === "answered" &&
        outcome.status === "answered" &&
        connectionId === outcome.responderId
      ) {
        continue; // 应答者自己不需要"关闭"指令
      }
      this.#bus.sendTo(connectionId, { type: "ui.cancel", id, reason });
    }
    pending.resolve(outcome);
  }

  /**
   * 谁能承载这次交互：必须有 interaction.respond 能力，且信任级别允许应答。
   * 有已认证的通路时只广播给它们；只有未认证通路时才退回到按来历排序。
   */
  #respondersFor(sessionId: string | null): AttachmentView[] {
    if (sessionId === null) return [];
    const candidates = this.#bus
      .attachmentsFor(sessionId)
      .filter(
        (attachment) =>
          attachment.capabilities.includes("interaction.respond") &&
          canRespondToInteraction(attachment.trustLevel),
      );
    if (candidates.length === 0) return [];
    return [...candidates].sort(
      (a, b) => interactionPriority(a.trustLevel) - interactionPriority(b.trustLevel),
    );
  }
}
