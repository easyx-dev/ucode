/**
 * pi 会话对象 ↔ 入库索引 / `SessionInfo` 的转换。
 *
 * 索引口径与 pi 的 `buildSessionInfo` 对齐：`preview` 取首条 user 文本，
 * `updatedAt` 取最新消息时间（回落 header 时间）。
 */
import { existsSync } from "node:fs";
import type { SessionEntry, SessionInfo, SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionIndex, SessionRecord } from "../db/session-repository";
import { workspaceDirOf } from "../harness/workspace";
import { isRecord } from "../utils/object";

const isoOf = (time: number): string => new Date(time).toISOString();

/** 消息时间：优先消息自身时间戳，回落条目 ISO 时间 */
const entryTime = (entry: SessionEntry): number | undefined => {
  if (entry.type !== "message") return undefined;
  const timestamp = (entry.message as { timestamp?: unknown }).timestamp;
  if (typeof timestamp === "number") return timestamp;
  const parsed = Date.parse(entry.timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join(" ");
};

/** 提取入库索引；未落盘（拿不到 header，或文件尚未写出）时返回 null */
export const managerToIndex = (manager: SessionManager): SessionIndex | null => {
  const header = manager.getHeader();
  const sourcePath = manager.getSessionFile();
  // pi 只在有 assistant 回复时才真正写文件，sessionFile 已就绪但文件未落盘的窗口期不建索引
  if (!header || !sourcePath || !existsSync(sourcePath)) return null;

  const entries = manager.getEntries();
  let preview = "";
  let lastActivity = 0;

  for (const entry of entries) {
    // 合成输入（目标启动 / 续跑、计划批准）也是「用户侧的第一句」：
    // 目标会话没有普通用户消息，不认它会在侧栏退化成「新会话」
    if (entry.type === "custom_message") {
      const time = Date.parse(entry.timestamp);
      if (!Number.isNaN(time)) lastActivity = Math.max(lastActivity, time);
      if (!preview) preview = textOf(entry.content).trim();
      continue;
    }
    if (entry.type !== "message") continue;
    const time = entryTime(entry);
    if (typeof time === "number") lastActivity = Math.max(lastActivity, time);
    if (preview) continue;
    if (entry.message.role === "user") preview = textOf(entry.message.content).trim();
  }

  const headerTime = Date.parse(header.timestamp);
  const fallbackTime = Number.isNaN(headerTime) ? Date.now() : headerTime;

  return {
    sourcePath,
    preview,
    createdAt: isoOf(Number.isNaN(headerTime) ? fallbackTime : headerTime),
    updatedAt: isoOf(lastActivity > 0 ? lastActivity : fallbackTime),
  };
};

/** DB 行还原成 pi 的 `SessionInfo`，让 serialize 与旧路径复用同一套 DTO 口径 */
export const recordToInfo = (record: SessionRecord): SessionInfo => ({
  path: record.sourcePath ?? "",
  id: record.id,
  // 未绑定目录的会话，工作区就是它的工作目录（与 draftSessionSummary 同一口径）
  cwd: record.cwd ?? workspaceDirOf(record.id),
  ...(record.name ? { name: record.name } : {}),
  created: new Date(record.createdAt),
  modified: new Date(record.updatedAt),
  // 消息数不再入库（前端不展示），这里只满足 pi 的类型
  messageCount: 0,
  firstMessage: record.preview || "(no messages)",
  allMessagesText: record.preview,
});
