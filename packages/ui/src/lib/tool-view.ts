/**
 * 工具调用的展示派生：把工具名 / 入参收敛成界面需要的分类、入参摘要与 diff。
 * 只做纯计算，不引入 i18n——中文文案由组件用 `t()` 取，避免在纯逻辑里散落界面文案。
 */
import { type DiffLine, diffLines } from "./text-diff";

export type ToolKind =
  | "read"
  | "write"
  | "edit"
  | "command"
  | "search"
  | "list"
  | "network"
  | "agent"
  | "other";

/** 摘要里的粗分类：读 / 写 / 执行 / 搜索 / 网络 / 其他 */
export type ToolBucket = "read" | "write" | "command" | "search" | "network" | "other";

const KIND_BY_NAME: Record<string, ToolKind> = {
  read: "read",
  write: "write",
  edit: "edit",
  bash: "command",
  grep: "search",
  find: "search",
  ls: "list",
  webfetch: "network",
  websearch: "network",
  subagent: "agent",
};

export const toolKindOf = (name: string): ToolKind => KIND_BY_NAME[name] ?? "other";

export const toolBucketOf = (kind: ToolKind): ToolBucket => {
  switch (kind) {
    case "read":
      return "read";
    case "write":
    case "edit":
      return "write";
    case "command":
      return "command";
    case "search":
    case "list":
      return "search";
    case "network":
      return "network";
    default:
      return "other";
  }
};

/** 摘要分类的中文标签由组件用 `t()` 取，纯逻辑里不落界面文案 */

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** 允许空串（如 edit 的 newText 可整体删除） */
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** 入参里的文件路径；pi 的 read / edit 存在 `file_path` 别名 */
const argPath = (record: Record<string, unknown>): string | undefined =>
  str(record.file_path) ?? str(record.path);

/** read 的行号范围展示，如 `12-45` 或 `100` */
const readRange = (record: Record<string, unknown>): string | undefined => {
  const offset = num(record.offset);
  const limit = num(record.limit);
  if (offset === undefined && limit === undefined) return undefined;
  const start = offset ?? 1;
  return limit !== undefined ? `${start}-${start + limit - 1}` : `${start}`;
};

export type ToolInput =
  | { type: "path"; path: string; range?: string }
  | { type: "command"; command: string }
  | { type: "pattern"; pattern: string; scope?: string }
  | { type: "url"; url: string }
  | { type: "query"; query: string }
  | { type: "none" };

export const toolInputOf = (name: string, args: unknown): ToolInput => {
  const record = asRecord(args);
  const path = argPath(record);

  switch (name) {
    case "read": {
      if (!path) return { type: "none" };
      const range = readRange(record);
      return range ? { type: "path", path, range } : { type: "path", path };
    }
    case "write":
    case "edit":
      return path ? { type: "path", path } : { type: "none" };
    case "bash": {
      const command = str(record.command);
      return command ? { type: "command", command } : { type: "none" };
    }
    case "grep":
    case "find": {
      const pattern = str(record.pattern);
      if (!pattern) return { type: "none" };
      const scope = str(record.path) ?? str(record.glob);
      return scope ? { type: "pattern", pattern, scope } : { type: "pattern", pattern };
    }
    case "ls":
      return { type: "path", path: path ?? "." };
    case "webfetch": {
      const url = str(record.url);
      return url ? { type: "url", url } : { type: "none" };
    }
    case "websearch": {
      const query = str(record.query);
      return query ? { type: "query", query } : { type: "none" };
    }
    default:
      return { type: "none" };
  }
};

/** edit 的改动列表；兼容 `edits[]` 与单组 `oldText` / `newText` */
export const editChanges = (args: unknown): Array<{ oldText: string; newText: string }> => {
  const record = asRecord(args);
  const edits = record.edits;
  if (Array.isArray(edits)) {
    return edits.flatMap((edit) => {
      const item = asRecord(edit);
      const oldText = text(item.oldText);
      const newText = text(item.newText);
      return oldText !== undefined && newText !== undefined ? [{ oldText, newText }] : [];
    });
  }
  const oldText = text(record.oldText);
  const newText = text(record.newText);
  return oldText !== undefined && newText !== undefined ? [{ oldText, newText }] : [];
};

const writeContent = (args: unknown): string | undefined => text(asRecord(args).content);

/** 编辑 / 写入的差异行；其它工具返回 null 表示走普通输出 */
export const toolDiff = (name: string, args: unknown): DiffLine[] | null => {
  if (name === "write") {
    const content = writeContent(args);
    return content === undefined ? null : diffLines("", content);
  }
  if (name === "edit") {
    const changes = editChanges(args);
    if (changes.length === 0) return null;
    const lines: DiffLine[] = [];
    changes.forEach((change, index) => {
      // 多次改动之间空一行，便于区分不同 hunk
      if (index > 0) lines.push({ type: "ctx", text: "" });
      lines.push(...diffLines(change.oldText, change.newText));
    });
    return lines;
  }
  return null;
};

export type ToolSummary = {
  total: number;
  failed: number;
  buckets: Array<{ bucket: ToolBucket; count: number }>;
};

/** 一组工具调用的分类计数（摘要头用）；bucket 顺序固定，只保留非零项 */
export const summarizeToolEntries = (
  entries: ReadonlyArray<{ name: string; isError?: boolean }>,
): ToolSummary => {
  const counts = new Map<ToolBucket, number>();
  let failed = 0;
  for (const entry of entries) {
    const bucket = toolBucketOf(toolKindOf(entry.name));
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    if (entry.isError) failed += 1;
  }
  const order: ToolBucket[] = ["read", "write", "command", "search", "network", "other"];
  return {
    total: entries.length,
    failed,
    buckets: order
      .filter((bucket) => counts.has(bucket))
      .map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 })),
  };
};
