/**
 * 会话记录的形状（协议 D 层，spec §3.3 / §3.12）。
 *
 * 协议 D **不规定字节格式**（那是【实现级】），但规定四条性质：
 * 追加式、带父指针的树、单调游标、每会话独立。这些性质在本文件与 parse 函数里体现。
 */

/** 会话记录格式版本：沿用 pi 的版本号（由 pi 演进，不由我们决定）。 */
export const CURRENT_SESSION_VERSION = 3;

export type SessionHeader = {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
};

export type SessionEntryBase = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
};

export type SessionEntry = SessionEntryBase & Record<string, unknown>;

export type FileEntry = SessionHeader | SessionEntry;

export function isSessionHeader(entry: FileEntry): entry is SessionHeader {
  return entry.type === "session" && typeof (entry as SessionHeader).cwd === "string";
}

export type ParsedSessionFile = {
  header: SessionHeader | null;
  /** entry 的行序号从 1 开始：header 是第 0 行（游标 = 行序号，spec §3.12）。 */
  entries: { seq: number; entry: SessionEntry }[];
  /** 尾部不完整的残行（崩溃可能留下），不算数据。 */
  partialTail: string;
  /** 因无法解析而被跳过的行数（诊断用，正常应为 0）。 */
  brokenLines: number;
};

/**
 * 解析会话文件内容。
 *
 * 两条必须守住的规则：
 * 1. **只解析到最后一个完整换行**，余下留作 partialTail（跟随者与接管者都靠这条识别崩溃尾部）；
 * 2. 单行解析失败不抛错而是跳过并计数——一个损坏的行不该让整个会话不可读。
 */
export function parseSessionFile(content: string): ParsedSessionFile {
  const lastNewline = content.lastIndexOf("\n");
  const complete = lastNewline === -1 ? "" : content.slice(0, lastNewline);
  const partialTail = lastNewline === -1 ? content : content.slice(lastNewline + 1);
  const lines = complete === "" ? [] : complete.split("\n");

  let header: SessionHeader | null = null;
  const entries: { seq: number; entry: SessionEntry }[] = [];
  let brokenLines = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      brokenLines += 1;
      continue;
    }
    if (index === 0) {
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as FileEntry).type === "session"
      ) {
        header = parsed as SessionHeader;
        continue;
      }
      // 第 0 行不是 header：按"非会话文件"处理，不猜测。
      brokenLines += 1;
      continue;
    }
    if (!isValidEntry(parsed)) {
      brokenLines += 1;
      continue;
    }
    entries.push({ seq: index, entry: parsed as SessionEntry });
  }

  return { header, entries, partialTail, brokenLines };
}

function isValidEntry(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const entry = raw as Record<string, unknown>;
  return (
    typeof entry.type === "string" &&
    typeof entry.id === "string" &&
    (typeof entry.parentId === "string" || entry.parentId === null) &&
    typeof entry.timestamp === "string"
  );
}

/** 一条记录序列化为一行（JSON 会把换行转义，因此"一记录一行"成立）。 */
export function serializeEntry(entry: FileEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

/** 从记录里取纯文本（列表页展示首条消息用）。 */
export function entryText(entry: SessionEntry): string | undefined {
  const message = entry.message;
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as Record<string, unknown>).type === "text"
    ) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

export function entryRole(entry: SessionEntry): string | undefined {
  const message = entry.message;
  if (typeof message !== "object" || message === null) return undefined;
  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}
