/**
 * 附件存取：内容寻址（sha256），元数据落 SQLite（见 `db/attachment-repository`），
 * 字节写 `<dir>/<id>`。图片与非图片共用同一套 id 与路径规则。
 *
 * 存的是「最终字节」：图片是归一化之后的内容，所以 pi 回写进会话 JSONL 的 base64
 * 与这里完全一致，历史投影按 JSONL 重算的 sha256 才能命中同一个附件。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AttachmentRecord, AttachmentRepository } from "../../../db/attachment-repository";
import { env } from "../../../env";

/** 存取依赖：仓储必传，目录缺省取 `$APP_HOME/app/attachments`（测试可覆盖） */
export type AttachmentDeps = { repo: AttachmentRepository; dir?: string };

/** 附件记录 + 磁盘路径 */
export type ResolvedAttachment = AttachmentRecord & { path: string };

/** 附件 id：64 位小写 hex（sha256） */
const ID_PATTERN = /^[0-9a-f]{64}$/;

/** 是否为合法的附件 id（路由与仓储共用同一套校验） */
export const isAttachmentId = (value: string): boolean => ID_PATTERN.test(value);

export const attachmentIdOf = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** 写入附件：字节落盘（同内容跳过重复写），元数据入库；同内容已存在时返回已有记录 */
export const putAttachment = (
  bytes: Uint8Array,
  meta: { mimeType: string; name?: string | null },
  deps: AttachmentDeps,
): AttachmentRecord => {
  const dir = deps.dir ?? env.attachmentsDir;
  const id = attachmentIdOf(bytes);
  const path = join(dir, id);
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, bytes);
  }

  const existing = deps.repo.find(id);
  if (existing) return existing;

  const record: AttachmentRecord = {
    id,
    mimeType: meta.mimeType,
    name: meta.name ?? null,
    size: bytes.length,
    createdAt: new Date().toISOString(),
    referencedAt: null,
  };
  deps.repo.insert(record);
  return record;
};

/** 按 id 取回附件（元数据 + 磁盘路径）；非法 id、无元数据或文件缺失都返回 null */
export const resolveAttachment = (id: string, deps: AttachmentDeps): ResolvedAttachment | null => {
  if (!ID_PATTERN.test(id)) return null;
  const record = deps.repo.find(id);
  if (!record) return null;
  const path = join(deps.dir ?? env.attachmentsDir, id);
  return existsSync(path) ? { ...record, path } : null;
};

/**
 * 把一份字节收进附件库并标记为「已被消息引用」。
 *
 * 用在会话记录里的图片上（工具产出的截图 / 读到的图、用户发过的图）：界面只能按附件路由取字节，
 * 而这些图片原本只以 base64 躺在会话记录里，不落库就取不到。
 *
 * 标记引用是必须的：这份字节的来源是**已落盘的会话记录**、不是草稿，按草稿语义（`referenced_at` 为空）
 * 会被 TTL 清掉——历史里明明还有图，界面却先坏了。幂等：同内容不会重复写，重复标记也不改时间。
 */
export const materializeAttachment = (
  bytes: Uint8Array,
  mimeType: string,
  deps: AttachmentDeps,
): AttachmentRecord => {
  const record = putAttachment(bytes, { mimeType }, deps);
  deps.repo.markReferenced([record.id], new Date().toISOString());
  return record;
};

/**
 * 清理「从未被消息引用、且早于 `before` 创建」的草稿临时附件（元数据 + 字节）。
 * 被引用过的附件永久保留，不受 TTL 影响。返回删除数量。
 */
export const expireTempAttachments = (deps: AttachmentDeps, before: string): number => {
  const ids = deps.repo.deleteExpired(before);
  const dir = deps.dir ?? env.attachmentsDir;
  for (const id of ids) rmSync(join(dir, id), { force: true });
  return ids.length;
};
