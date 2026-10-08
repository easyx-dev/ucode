/**
 * 工具调用的展示派生：把工具名 / 入参收敛成界面需要的分类、入参摘要与 diff。
 * 只做纯计算，不引入 i18n——中文文案由组件用 `t()` 取，避免在纯逻辑里散落界面文案。
 */
import type { ToolEntry } from "./chat-nodes";
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

/**
 * 一组调用的工具名计数。
 *
 * 按首次出现顺序返回（流式追加只会在尾部改变计数，不会重排已有的条目），界面据此拼出「编辑 3 · 运行 2」
 * 这类摘要——比按粗分类计数更能说明这批调用到底在干什么，也不会把不认识的工具兜成「其他」。
 */
export const summarizeToolNames = (
  entries: readonly ToolEntry[],
): Array<{ name: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
};

/**
 * 子智能体开的子会话 id：`subagent` 工具的结果首行就是 `task_id: <id>（需要时可带 task_id 续跑）`。
 * 子会话跑完之后进度快照里已经没有它了，事后回看只能靠这一行。
 *
 * 两个细节都是实测出来的，改的时候一起看：id 形如 `sub-<uuid>`（`server/src/harness/subagents/spawn.ts`
 * 的 `sub-${randomUUID()}`），所以不能按裸 uuid 匹配；id 后面紧跟全角括号，不能按空白切。
 * 输出模板在 `server/src/harness/subagents/tool.ts`。
 */
const TASK_ID_LINE = /^task_id:\s*([\w-]+)/m;

export const subagentSessionIdOf = (entry: ToolEntry): string | null =>
  entry.result ? (TASK_ID_LINE.exec(entry.result)?.[1] ?? null) : null;
