/**
 * 项目记忆的文件层：`MEMORY.md` 索引 + 每条记忆一个 Markdown 事实文件。
 *
 * 索引呈给两类消费方：装配层把它注入上下文（`readIndexText`），remember / forget 工具读写它。
 * 读写都是同步 fs 调用，单进程的事件循环不会在中间插入其它操作，因此不加锁；
 * 真正可能并发的是「自动回顾」与「工具调用」，但它们各自的一次读改写也是整段同步跑完的。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { MEMORY_INDEX_FILENAME } from "../../../constants/dirs";
import { MEMORY_DESCRIPTION_MAX_LENGTH, MEMORY_SLUG_MAX_LENGTH } from "../../../constants/memory";
import { memoryIndexPath, memoryProjectDir } from "./paths";

export type MemoryIndexEntry = {
  /** 事实文件名（仅文件名，与索引同目录） */
  file: string;
  title: string;
  description: string;
};

export type MemoryFactInput = {
  title: string;
  /** 事实正文，写成脱离本轮对话也能读懂的一段 */
  content: string;
};

const INDEX_HEADER = "# 项目记忆";
const INDEX_LINE = /^-\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[：:]\s*(.*))?$/;

/** 索引里的文件名必须是不带目录的 `.md`；否则视为脏数据忽略，避免手改索引做路径穿越 */
const safeFileName = (value: string): string | null => {
  const name = basename(value);
  if (name !== value || name === "." || name === ".." || !name.endsWith(".md")) return null;
  return name;
};

const slugOf = (title: string): string => {
  const slug = title
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, MEMORY_SLUG_MAX_LENGTH);
  return slug || "memory";
};

/**
 * 标题会写进索引的 `[标题](文件)`，方括号或换行会破坏索引行、回读时丢条目或解析出错位条目，
 * 这里统一折叠成单行并去掉方括号。
 */
const sanitizeTitle = (title: string): string => {
  const cleaned = title
    .replace(/[\r\n]+/g, " ")
    .replace(/[[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "未命名记忆";
};

/** 描述取正文第一行非空内容，过长即截断——它只用于索引展示与检索 */
const describe = (content: string): string => {
  const line = content.split(/\r?\n/).find((item) => item.trim()) ?? "";
  return line.trim().slice(0, MEMORY_DESCRIPTION_MAX_LENGTH);
};

const renderIndex = (entries: readonly MemoryIndexEntry[]): string =>
  `${[
    INDEX_HEADER,
    ...entries.map((entry) => {
      const suffix = entry.description ? `：${entry.description}` : "";
      return `- [${entry.title}](${entry.file})${suffix}`;
    }),
  ].join("\n")}\n`;

/** 读索引；文件不存在或没有合法条目时返回空数组 */
export const readIndex = (cwd: string, appDir: string): MemoryIndexEntry[] => {
  const path = memoryIndexPath(cwd, appDir);
  if (!existsSync(path)) return [];

  const entries: MemoryIndexEntry[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = INDEX_LINE.exec(raw.trim());
    if (!match) continue;
    const file = safeFileName(match[2] ?? "");
    if (!file) continue;
    entries.push({ file, title: match[1] ?? file, description: match[3]?.trim() ?? "" });
  }
  return entries;
};

/** 供上下文注入的索引正文；没有条目时返回 null，让装配层干脆不注入 */
export const readIndexText = (cwd: string, appDir: string): string | null => {
  const entries = readIndex(cwd, appDir);
  return entries.length > 0 ? renderIndex(entries) : null;
};

const writeIndex = (cwd: string, appDir: string, entries: readonly MemoryIndexEntry[]): void => {
  const dir = memoryProjectDir(cwd, appDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, MEMORY_INDEX_FILENAME), renderIndex(entries), "utf8");
};

const readFactContent = (cwd: string, appDir: string, file: string): string => {
  const name = safeFileName(file);
  if (!name) return "";
  const path = resolve(memoryProjectDir(cwd, appDir), name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

/** slug 撞名时顺延编号；同名标题走替换而非新增 */
const uniqueFileName = (entries: readonly MemoryIndexEntry[], slug: string): string => {
  let candidate = `${slug}.md`;
  let index = 2;
  while (entries.some((entry) => entry.file === candidate)) {
    candidate = `${slug}-${index}.md`;
    index += 1;
  }
  return candidate;
};

/** 写入一条事实：同名标题覆盖，否则新增；返回落成后的索引条目 */
export const rememberFact = (
  cwd: string,
  input: MemoryFactInput,
  appDir: string,
): MemoryIndexEntry => {
  const title = sanitizeTitle(input.title);
  const content = input.content.trim();
  const entries = readIndex(cwd, appDir);
  const existing = entries.find((entry) => entry.title === title);
  const file = existing?.file ?? uniqueFileName(entries, slugOf(title));
  const entry: MemoryIndexEntry = { file, title, description: describe(content) };

  const dir = memoryProjectDir(cwd, appDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, file), `# ${title}\n\n${content}\n`, "utf8");
  writeIndex(
    cwd,
    appDir,
    existing ? entries.map((item) => (item.file === file ? entry : item)) : [...entries, entry],
  );
  return entry;
};

/**
 * 删除匹配的事实：关键词大小写不敏感地匹配标题、描述与正文，命中即删文件并从索引移除。
 * 返回被删条目供工具回话。
 */
export const forgetFacts = (cwd: string, query: string, appDir: string): MemoryIndexEntry[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const deleted: MemoryIndexEntry[] = [];
  const kept: MemoryIndexEntry[] = [];
  for (const entry of readIndex(cwd, appDir)) {
    const haystack =
      `${entry.title}\n${entry.description}\n${readFactContent(cwd, appDir, entry.file)}`.toLowerCase();
    if (haystack.includes(needle)) {
      rmSync(resolve(memoryProjectDir(cwd, appDir), entry.file), { force: true });
      deleted.push(entry);
    } else {
      kept.push(entry);
    }
  }

  if (deleted.length > 0) {
    // 全部清空时连索引一起删掉，避免留下只剩标题的空文件
    if (kept.length === 0) rmSync(memoryIndexPath(cwd, appDir), { force: true });
    else writeIndex(cwd, appDir, kept);
  }
  return deleted;
};
