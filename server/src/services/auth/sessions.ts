/**
 * 登录会话：签发 / 校验 / 撤销 / 列举。
 *
 * 明文 token 只在签发响应里回一次（登录 / 配对兑换），库内只存 sha256；来源不可信时也无法反推 token。
 * 会话可撤销（改密码撤销全部），默认 30 天有效期。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { AUTH_SESSION_TTL_MS } from "../../constants/auth";
import type { AuthSessionRecord, AuthSessionRepository } from "../../db/auth-session-repository";

/** token 哈希：落库与查找都用它，明文不持久化 */
export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export type IssuedSession = {
  /** 明文 token，仅此一次返回给客户端 */
  token: string;
  record: AuthSessionRecord;
};

export class SessionService {
  constructor(private readonly repo: AuthSessionRepository) {}

  create(label: string, now = new Date()): IssuedSession {
    const token = randomBytes(32).toString("base64url");
    const at = now.toISOString();
    const record: AuthSessionRecord = {
      id: randomUUID(),
      tokenHash: hashSessionToken(token),
      createdAt: at,
      expiresAt: new Date(now.getTime() + AUTH_SESSION_TTL_MS).toISOString(),
      lastSeenAt: at,
      revokedAt: null,
      label,
    };
    this.repo.create(record);
    return { token, record };
  }

  /** 校验 token 对应会话是否有效；有效则刷新 lastSeenAt 并返回（含刷新后的时间） */
  authenticate(token: string, now = new Date()): AuthSessionRecord | null {
    const record = this.repo.findByTokenHash(hashSessionToken(token));
    if (!record || record.revokedAt) return null;
    if (record.expiresAt <= now.toISOString()) return null;
    const at = now.toISOString();
    this.repo.touch(record.id, at);
    return { ...record, lastSeenAt: at };
  }

  revoke(id: string, now = new Date()): boolean {
    return this.repo.revoke(id, now.toISOString());
  }

  /** 撤销全部未撤销会话，返回撤销数 */
  revokeAll(now = new Date()): number {
    return this.repo.revokeAll(now.toISOString());
  }

  list(now = new Date()): AuthSessionRecord[] {
    return this.repo.listActive(now.toISOString());
  }

  /** 清理过期会话行，返回删除数 */
  prune(now = new Date()): number {
    return this.repo.deleteExpired(now.toISOString());
  }
}
