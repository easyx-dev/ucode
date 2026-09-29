/**
 * 会话事件总线：把 pi 的事件从 HTTP 请求生命周期里摘出来统一分发。
 *
 * - AgentSession 入池时 attach；事件分配会话内单调序号后扇出。
 * - 事件不落盘：客户端刷新 / 断线后一律重取快照（投影含在途内容），
 *   增量不承担重建状态的职责，因此不需要补放，也不存在跨源合并的顺序问题。
 * - 序号常驻进程内存（跨会话池回收保留），与 `messages/list` 的投影一起
 *   构成「快照 + 接续」的一致性边界：投影与序号在同一同步块读取。
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ServerEvent } from "@ucode/contracts";

import { toSseEvents } from "./events";

export type EventSubscriber = (frame: ServerEvent) => void;

export class SessionEventBus {
  private readonly subscribers = new Set<EventSubscriber>();
  private readonly attached = new Map<string, () => void>();
  private readonly sequences = new Map<string, number>();

  attach(sessionId: string, session: AgentSession): void {
    if (this.attached.has(sessionId)) return;
    const unsubscribe = session.subscribe((event) => {
      for (const item of toSseEvents(event)) {
        this.publish({
          type: item.event,
          sessionId,
          seq: this.nextSeq(sessionId),
          data: item.data,
        });
      }
    });
    this.attached.set(sessionId, unsubscribe);
  }

  detach(sessionId: string): void {
    const unsubscribe = this.attached.get(sessionId);
    if (!unsubscribe) return;
    this.attached.delete(sessionId);
    try {
      unsubscribe();
    } catch {
      // pi 侧已释放，忽略
    }
  }

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** 服务端自身产生的错误帧 */
  emitError(sessionId: string, code: string, message: string): void {
    this.publish({ type: "error", sessionId, code, message });
  }

  /** 快照序号：与 messages/list 的投影同一次同步读取，客户端按它切分实时帧 */
  latestSeq(sessionId: string): number {
    return this.sequences.get(sessionId) ?? 0;
  }

  /** 会话被删除时清理序号；会话池回收只 detach，不重置序号以免客户端错判新旧 */
  remove(sessionId: string): void {
    this.sequences.delete(sessionId);
  }

  private nextSeq(sessionId: string): number {
    const next = (this.sequences.get(sessionId) ?? 0) + 1;
    this.sequences.set(sessionId, next);
    return next;
  }

  private publish(frame: ServerEvent): void {
    for (const subscriber of this.subscribers) subscriber(frame);
  }
}
