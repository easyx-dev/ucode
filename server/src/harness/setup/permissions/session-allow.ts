/**
 * 会话级授权：用户点「本会话恒允」后追加的 allow 规则。
 *
 * 不单独维护放行集合，而是把一次授权当成一条追加在规则表末尾的 allow 规则，
 * 与模式规则走同一个 `decidePermission`。这样「恒允」的作用域直接落在 pattern 上：
 * 规则类 ask 记规则串，越界检查记父目录通配（由 `engine.externalScope` 产生）。
 *
 * 只存进程内存：删会话时清空，服务重启回到规则默认。
 */
import type { PermissionRule } from "./engine";

export class SessionAllowStore {
  private readonly rules = new Map<string, PermissionRule[]>();

  /** 该会话已追加的授权规则，按追加顺序返回（后者优先） */
  list(sessionId: string): readonly PermissionRule[] {
    return this.rules.get(sessionId) ?? [];
  }

  /** 追加一条授权规则；同 (工具, 范围) 去重，避免重复授权堆叠 */
  add(sessionId: string, rule: PermissionRule): void {
    const existing = this.rules.get(sessionId) ?? [];
    if (existing.some((item) => item.tool === rule.tool && item.pattern === rule.pattern)) return;
    existing.push(rule);
    this.rules.set(sessionId, existing);
  }

  clear(sessionId: string): void {
    this.rules.delete(sessionId);
  }
}
