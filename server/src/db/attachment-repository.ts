/**
 * 附件元数据仓储：内容是文件系统里的原始字节，这里只存元数据索引。
 *
 * `id` 是**内容寻址**的 sha256（不是 `randomUUID`）——同一份内容同一个 id，
 * 因此 `insert` 冲突即已存在、直接跳过。字节文件由 `harness/features/attachment` 负责读写。
 * `referenced_at` 为空表示只被草稿引用过、可过期；被消息引用后置为时间且不再回退。
 * 命名与 SQL 规则见 `docs/database.md`。
 */
import { z } from "zod";

import { openDatabase } from "./";

export type AttachmentRecord = {
  /** 内容 id（sha256 hex） */
  id: string;
  mimeType: string;
  /** 原始文件名；未提供时为 null */
  name: string | null;
  /** 入库字节数 */
  size: number;
  /** 入库时间（ISO 8601 UTC） */
  createdAt: string;
  /** 被消息引用的时间；为空表示仍属「草稿临时附件」，可过期 */
  referencedAt: string | null;
};

const rowSchema = z.object({
  id: z.string(),
  mime_type: z.string(),
  name: z.string().nullable(),
  size: z.number(),
  created_at: z.string(),
  referenced_at: z.string().nullable(),
});

type AttachmentRow = z.infer<typeof rowSchema>;

const rowToRecord = (row: AttachmentRow): AttachmentRecord => ({
  id: row.id,
  mimeType: row.mime_type,
  name: row.name,
  size: row.size,
  createdAt: row.created_at,
  referencedAt: row.referenced_at,
});

const COLUMNS = "id, mime_type, name, size, created_at, referenced_at";

export class AttachmentRepository {
  constructor(private readonly db = openDatabase()) {}

  /** 写入元数据；同 id 已存在则跳过（内容寻址天然去重） */
  insert(record: AttachmentRecord): void {
    this.db
      .prepare(
        `INSERT INTO attachment (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        record.id,
        record.mimeType,
        record.name,
        record.size,
        record.createdAt,
        record.referencedAt,
      );
  }

  find(id: string): AttachmentRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM attachment WHERE id = ?`).get(id) as
      | AttachmentRow
      | undefined;
    if (!row) return null;
    const parsed = rowSchema.safeParse(row);
    return parsed.success ? rowToRecord(parsed.data) : null;
  }

  /** 标记为「已被消息引用」；已标记过的保持不变（幂等） */
  markReferenced(ids: readonly string[], at: string): void {
    if (ids.length === 0) return;
    const statement = this.db.prepare(
      "UPDATE attachment SET referenced_at = ? WHERE id = ? AND referenced_at IS NULL",
    );
    for (const id of ids) statement.run(at, id);
  }

  /** 删除「从未被引用且早于 `before` 创建」的附件，返回真正删掉的 id（供调用方清理文件） */
  deleteExpired(before: string): string[] {
    const rows = this.db
      .prepare("SELECT id FROM attachment WHERE referenced_at IS NULL AND created_at < ?")
      .all(before) as Array<{ id: string }>;
    if (rows.length === 0) return [];

    // DELETE 再带一次 referenced_at 条件：SELECT 与 DELETE 之间若有 markReferenced 命中，
    // 该行不会被删，也就不会误删它对应的文件
    const removed: string[] = [];
    this.db.exec("BEGIN");
    try {
      const remove = this.db.prepare(
        "DELETE FROM attachment WHERE id = ? AND referenced_at IS NULL",
      );
      for (const row of rows) {
        if (remove.run(row.id).changes > 0) removed.push(row.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return removed;
  }
}
