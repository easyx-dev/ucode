import { isMemoryType, type MemoryType } from "./paths.ts";

/**
 * 记忆条目的磁盘格式：YAML frontmatter + Markdown 正文。
 *
 * 只支持一个极小的 YAML 子集（`key: value` 单行），足以承载 name/description/type，
 * 且人可读、可用任何编辑器手改——刻意不引入 YAML 依赖，避免"格式越复杂越难手改"。
 */

export type MemoryFact = {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  /** 来源文件绝对路径。 */
  file: string;
  /** 文件 mtime（ISO），用于排序与"最近更新"提示。 */
  updatedAt: string;
};

const FRONTMATTER_FENCE = "---";

/** 读取一段 frontmatter（`---` 包裹的 `key: value` 行）。未闭合或缺失时返回空表。 */
function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return { fields: {}, body: raw };
  const fields: Record<string, string> = {};
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    if (line.trim() === FRONTMATTER_FENCE) {
      end = index;
      break;
    }
    const match = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      fields[match[1]] = stripQuotes(match[2] ?? "");
    }
  }
  if (end === -1) return { fields: {}, body: raw };
  return {
    fields,
    body: lines
      .slice(end + 1)
      .join("\n")
      .replace(/^\n+/, ""),
  };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^".*"$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && /^'.*'$/.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function parseMemoryFact(file: string, raw: string, updatedAt: string): MemoryFact {
  const { fields, body } = parseFrontmatter(raw);
  const name = fields.name ?? file.replace(/\.md$/, "").split("/").pop() ?? "memory";
  const description = fields.description ?? firstNonEmptyLine(body);
  const type = isMemoryType(fields.type) ? fields.type : "project";
  return { name, description, type, body: body.trim(), file, updatedAt };
}

function firstNonEmptyLine(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed.slice(0, 200);
  }
  return "";
}

export function serializeMemoryFact(input: {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
}): string {
  const body = input.body.trim();
  return [
    FRONTMATTER_FENCE,
    `name: ${quote(input.name)}`,
    `description: ${quote(input.description)}`,
    `type: ${input.type}`,
    FRONTMATTER_FENCE,
    "",
    body,
    "",
  ].join("\n");
}

/** 索引里的一行：`- [name](name.md) — description`。 */
export function indexLine(fact: MemoryFact): string {
  const description = fact.description.length > 0 ? ` — ${fact.description}` : "";
  return `- [${fact.name}](${fact.name}.md)${description}`;
}

export function buildIndexContent(facts: MemoryFact[]): string {
  const lines = ["# MEMORY", ""];
  if (facts.length === 0) {
    lines.push("(空)", "");
    return lines.join("\n");
  }
  lines.push(...facts.map(indexLine), "");
  return lines.join("\n");
}
