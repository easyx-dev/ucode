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
import type {
  ContextUsage,
  EventName,
  ServerControlEvent,
  ServerEvent,
  SessionSummary,
  UsageTotals,
} from "@ucode/contracts";

import type { ProjectionDeps } from "../harness/pi/serialize";
import { type SseEvent, toSseEvents } from "./events";

export type EventSubscriber = (frame: ServerEvent) => void;

/**
 * 落盘后的条目 id：pi 把消息对象本身当成 key（`_entryIdsByMessage`），所以按对象身份在分支里找
 * 就是它对应的条目。查不到（落盘失败 / 分支已被改写）时返回 undefined，由调用方退回临时 id。
 */
const entryIdOfMessage = (session: AgentSession, message: unknown): string | undefined => {
  const branch = session.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === "message" && entry.message === message) return entry.id;
  }
  return undefined;
};

export class SessionEventBus {
  private readonly subscribers = new Set<EventSubscriber>();
  private readonly attached = new Map<string, () => void>();
  private readonly sequences = new Map<string, number>();

  /** `deps` 是投影依赖（图片落库）；由 services 构造时注入，总线自己不认识附件库 */
  constructor(private readonly deps: ProjectionDeps = {}) {}

  attach(sessionId: string, session: AgentSession): void {
    if (this.attached.has(sessionId)) return;
    const unsubscribe = session.subscribe((event) => {
      const state = { thinkingLevel: session.thinkingLevel };
      const publish = (frames: SseEvent[]): void => {
        for (const item of frames) {
          this.publish({
            type: item.event,
            sessionId,
            seq: this.nextSeq(sessionId),
            data: item.data,
          });
        }
      };

      if (event.type === "message_end") {
        // pi 先发 message_end、后 appendMessage：此刻还查不到条目 id，而界面拿这个 id 做编辑 / 分叉。
        // 落盘是同步跟在事件之后的，等一个微任务就能按消息对象身份把条目 id 找回来。
        const message = event.message;
        queueMicrotask(() => {
          const entryId = entryIdOfMessage(session, message);
          publish(
            toSseEvents(event, state, {
              ...(entryId ? { messageEntryId: entryId } : {}),
              deps: this.deps,
            }),
          );
        });
        return;
      }

      publish(toSseEvents(event, state, { deps: this.deps }));
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

  /** 服务端自身产生的错误帧；`message` 是中文兜底，客户端按 `code` + `params` 渲染 */
  emitError(
    sessionId: string,
    code: string,
    message: string,
    params?: Record<string, string>,
  ): void {
    this.emitControl({
      type: "error",
      sessionId,
      code,
      message,
      ...(params ? { params } : {}),
    });
  }

  /** 服务端自身产生的控制帧（无 sessionId、无 seq）：config_changed / mcp_changed 等 */
  emitControl(frame: ServerControlEvent): void {
    this.publish(frame);
  }

  /** 服务端自身产生的会话事件（如交互请求）；客户端按 type 过滤 */
  emitFrame(sessionId: string, type: EventName, data: unknown): void {
    this.publish({ type, sessionId, seq: this.nextSeq(sessionId), data });
  }

  /** 会话摘要增 / 改 / 删的统一下发点；`usage` 在需要客户端重算占用时带上，`contextUsage` 与它同帧 */
  emitSessionCreated(sessionId: string, session: SessionSummary): void {
    this.emitFrame(sessionId, "session_created", session);
  }

  emitSessionUpdated(
    sessionId: string,
    session: SessionSummary,
    usage?: UsageTotals,
    contextUsage?: ContextUsage | null,
  ): void {
    this.emitFrame(
      sessionId,
      "session_updated",
      usage ? { session, usage, contextUsage: contextUsage ?? null } : { session },
    );
  }

  emitSessionArchived(sessionId: string): void {
    this.emitFrame(sessionId, "session_archived", { sessionId });
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
