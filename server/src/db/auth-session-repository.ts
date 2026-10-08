/**
 * 登录会话仓储：浏览器会话 token 对应的可撤销会话。
 *
 * 库内只存 token 的 sha256（`token_hash`），明文只回客户端；`id` 是随机 uuid，
 * 可安全展示与用于撤销。schema v7，见 `docs/database.md`。
 */
import { z } from "zod";

import { openDatabase } from "./index";

export type AuthSessionRecord = {
  /** 会话 id（uuid），用于展示与撤销 */
  id: string;
  /** 会话 token 的 sha256 hex；明文不落库 */
  tokenHash: string;
  /** 签发时间（ISO 8601 UTC） */
  createdAt: string;
  /** 过期时间（ISO 8601 UTC） */
  expiresAt: string;
  /** 最近一次使用时间（ISO 8601 UTC） */
  lastSeenAt: string;
  /** 撤销时间；为空表示仍有效 */
  revokedAt: string | null;
  /** 会话标签（设备名 / 备注） */
  label: string;
};

const rowSchema = z.object({
  id: z.string(),
  token_hash: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  last_seen_at: z.string(),
  revoked_at: z.string().nullable(),
  label: z.string(),
});

type AuthSessionRow = z.infer<typeof rowSchema>;

const rowToRecord = (row: AuthSessionRow): AuthSessionRecord => ({
  id: row.id,
  tokenHash: row.token_hash,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  lastSeenAt: row.last_seen_at,
  revokedAt: row.revoked_at,
  label: row.label,
});

const COLUMNS = "id, token_hash, created_at, expires_at, last_seen_at, revoked_at, label";

export class AuthSessionRepository {
  constructor(private readonly db = openDatabase()) {}

  create(record: AuthSessionRecord): void {
    this.db
      .prepare(`INSERT INTO auth_session (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        record.id,
        record.tokenHash,
        record.createdAt,
        record.expiresAt,
        record.lastSeenAt,
        record.revokedAt,
        record.label,
      );
  }

  get(id: string): AuthSessionRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM auth_session WHERE id = ?`).get(id) as
      | AuthSessionRow
      | undefined;
    if (!row) return null;
    const parsed = rowSchema.safeParse(row);
    return parsed.success ? rowToRecord(parsed.data) : null;
  }

  findByTokenHash(tokenHash: string): AuthSessionRecord | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM auth_session WHERE token_hash = ?`)
      .get(tokenHash) as AuthSessionRow | undefined;
    if (!row) return null;
    const parsed = rowSchema.safeParse(row);
    return parsed.success ? rowToRecord(parsed.data) : null;
  }

  /** 全部未撤销会话，最近签发在前 */
  listActive(now: string): AuthSessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM auth_session
         WHERE revoked_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`,
      )
      .all(now) as AuthSessionRow[];
    return rows.flatMap((row) => {
      const parsed = rowSchema.safeParse(row);
      return parsed.success ? [rowToRecord(parsed.data)] : [];
    });
  }

  touch(id: string, at: string): void {
    this.db.prepare("UPDATE auth_session SET last_seen_at = ? WHERE id = ?").run(at, id);
  }

  /** 撤销单个会话；返回是否真的发生撤销（幂等：已撤销返回 false） */
  revoke(id: string, at: string): boolean {
    const result = this.db
      .prepare("UPDATE auth_session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(at, id);
    return result.changes > 0;
  }

  /** 撤销全部未撤销会话，返回撤销数（改密码用） */
  revokeAll(at: string): number {
    return Number(
      this.db.prepare("UPDATE auth_session SET revoked_at = ? WHERE revoked_at IS NULL").run(at)
        .changes,
    );
  }

  /** 清理已过期的会话行，返回删除数 */
  deleteExpired(before: string): number {
    return Number(
      this.db.prepare("DELETE FROM auth_session WHERE expires_at < ?").run(before).changes,
    );
  }
}
