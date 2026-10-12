/**
 * 后台服务的会话运行态：按端口记录 bash 命令调起的服务。
 *
 * 清单里只会有**上一次观测时可连**的服务——探不到即移除，所以条目上没有状态字段
 * （「在册」就等于「刚确认过在跑」；面板也不留只有历史意义的行）。
 * 只保留在进程内存、不落会话条目，口径与 `RunTracker` / `pool.subagents` 一致；
 * 状态本身不进 `SessionPool` 的字段（那个类已超出文件行数上限），池只负责接线。
 */
import type { BackgroundService } from "@ucode/contracts";

import { SERVICE_COMMAND_MAX_CHARS, SERVICE_MAX_TRACKED_PER_SESSION } from "../constants/tools";
import { probePort } from "../harness/features/shell/services";
import { logger } from "../platform/logger";
import type { SessionEventBus } from "./event-bus";

/** 命令原文在清单里的展示长度上限 */
const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export class BackgroundServices {
  /** 会话 → 端口 → 服务 */
  private readonly tracked = new Map<string, Map<string, BackgroundService>>();

  constructor(private readonly events: SessionEventBus) {}

  /** 命令结算后的命中项；同端口覆盖（命令与起始时刻换新） */
  observe(sessionId: string, observation: { command: string; cwd: string; port: number }): void {
    const now = new Date().toISOString();
    const services = this.tracked.get(sessionId) ?? new Map<string, BackgroundService>();
    const id = String(observation.port);
    services.set(id, {
      id,
      command: truncate(observation.command, SERVICE_COMMAND_MAX_CHARS),
      cwd: observation.cwd,
      port: observation.port,
      url: `http://127.0.0.1:${observation.port}`,
      startedAt: now,
      updatedAt: now,
    });
    this.tracked.set(sessionId, services);
    this.trim(sessionId, services);
    this.emit(sessionId);
  }

  /**
   * 重探本会话已知端口：探不到的移出清单，能连的刷新「最后一次确认」时刻。
   * 调用时机：每条 bash 命令结算后（`observe` 的调用方）、每轮 `agent_settled`、
   * 以及客户端打开活动面板时的那次读取。
   */
  async refresh(sessionId: string): Promise<void> {
    const services = this.tracked.get(sessionId);
    if (!services) return;

    const entries = [...services.values()];
    const results = await Promise.all(entries.map((service) => probePort(service.port)));
    let removed = false;
    entries.forEach((service, index) => {
      // 探测期间同一端口可能被重新起（`observe` 换了一份新条目）：那份记录也活着，别拿旧快照覆盖它
      if (services.get(service.id) !== service) return;
      if (results[index]) {
        services.set(service.id, { ...service, updatedAt: new Date().toISOString() });
        return;
      }
      services.delete(service.id);
      removed = true;
    });
    if (removed) this.emit(sessionId);
  }

  listOf(sessionId: string): BackgroundService[] {
    return [...(this.tracked.get(sessionId)?.values() ?? [])];
  }

  /**
   * 清理会话的服务清单，由归档 / 删除路径调用。
   *
   * **不随会话池的 `dispose` 清**：空闲回收与重装会把会话实例丢掉，但服务进程通常还在跑，
   * 清单跟着实例一起消失会让「后台服务」忽有忽无（实测：idle 回收窗口很短时几乎看不到）。
   */
  forget(sessionId: string): void {
    this.tracked.delete(sessionId);
  }

  /** 超出条数上限时丢最久没被确认可连的一项（重新起的服务会刷新 `updatedAt`，排在后面） */
  private trim(sessionId: string, services: Map<string, BackgroundService>): void {
    if (services.size <= SERVICE_MAX_TRACKED_PER_SESSION) return;
    const victim = [...services.values()].sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt),
    )[0];
    if (!victim) return;
    services.delete(victim.id);
    logger.warn({ sessionId, port: victim.port }, "后台服务清单超出上限，丢弃最久未确认的一项");
  }

  /** 全量下发：清单小、只反映「此刻在跑什么」，客户端收到即整份替换 */
  private emit(sessionId: string): void {
    this.events.emitFrame(sessionId, "service_update", this.listOf(sessionId));
  }
}
