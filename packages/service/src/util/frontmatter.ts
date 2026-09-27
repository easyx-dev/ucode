/**
 * 极小的 YAML frontmatter 子集解析（子智能体定义 F-3.3 与外部 Agent 导入 F-3.9 共用）。
 *
 * 支持：`key: value`、`key: [a, b]`、`key:` 后跟 `- item` 块列表、布尔与数字的字面量。
 * 刻意不引入完整 YAML 依赖——定义文件的复杂度应该停在"人能一眼看懂"这一层。
 */

export const FRONTMATTER_FENCE = "---";

export type FrontmatterValue = string | string[] | boolean | number;
export type FrontmatterFields = Record<string, FrontmatterValue>;

export function splitFrontmatter(raw: string): { fields: FrontmatterFields; body: string } {
  const lines = raw.split(/\r?\n/u);
  if (lines[0]?.trim() !== FRONTMATTER_FENCE) return { fields: {}, body: raw };

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_FENCE) {
      end = index;
      break;
    }
  }
  if (end === -1) return { fields: {}, body: raw };

  const fields = parseLines(lines.slice(1, end));
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/u, "");
  return { fields, body };
}

function parseLines(lines: string[]): FrontmatterFields {
  const fields: FrontmatterFields = {};
  let currentListKey: string | null = null;

  for (const line of lines) {
    if (line.trim() === "") continue;
    const blockItem = /^\s+-\s*(.*)$/u.exec(line);
    if (blockItem !== null && currentListKey !== null) {
      const value = stripQuotes(blockItem[1] ?? "");
      const existing = fields[currentListKey];
      if (Array.isArray(existing)) existing.push(value);
      else fields[currentListKey] = [value];
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s?(.*)$/u.exec(line);
    if (match?.[1] === undefined) continue;
    const key = match[1];
    const rest = (match[2] ?? "").trim();
    if (rest === "") {
      // 可能是块列表的开头
      currentListKey = key;
      fields[key] = [];
      continue;
    }
    currentListKey = null;
    fields[key] = parseScalar(rest);
  }
  return fields;
}

function parseScalar(raw: string): FrontmatterValue {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (inner === "") return [];
    return inner
      .split(",")
      .map((part) => stripQuotes(part.trim()))
      .filter((part) => part !== "");
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/u.test(raw)) return Number.parseInt(raw, 10);
  return stripQuotes(raw);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function asString(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function asStringArray(value: FrontmatterValue | undefined): string[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  return undefined;
}

export function asBoolean(value: FrontmatterValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asNumber(value: FrontmatterValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}
