/**
 * 资产文件的 frontmatter 处理：读出建模字段、保留未建模的行、按建模字段重建文件。
 *
 * 只做行级拼接，不重新序列化整份 YAML：用户手写在 frontmatter 里的额外字段（技能自带的元信息等）
 * 原样保留，服务端既不解释也不丢；写出去的键值只覆盖我们建模的那几个。
 */
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/** 形如 `key:` 的行首（frontmatter 的顶层键） */
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):/;

/** frontmatter 的原始 YAML 行；没有 frontmatter 时返回空数组 */
const yamlLinesOf = (content: string): string[] => {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) return [];
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return [];
  return normalized.slice(4, end).split("\n");
};

/**
 * 未建模键的原始行：按顶层键切块，只留下不在 `kept` 里的块。
 * 块内的续行（缩进的 `- item`、嵌套映射）跟着块首行一起走，所以取值不会被截断。
 */
export const extraFrontmatterLines = (content: string, kept: readonly string[]): string[] => {
  const keep = new Set(kept);
  const blocks: string[][] = [];
  for (const line of yamlLinesOf(content)) {
    const head = blocks[blocks.length - 1];
    if (KEY_LINE.test(line) || !head) blocks.push([line]);
    else head.push(line);
  }
  return blocks
    .filter((block) => {
      const key = KEY_LINE.exec(block[0] ?? "")?.[1];
      return key === undefined || !keep.has(key);
    })
    .flat();
};

/**
 * 回传的行是否安全：一项就是一行，所以先挡换行（含换行等于把内容拼到 frontmatter 之外）；
 * 再允许空行、缩进行与 `key:` 起始的块首行，禁止 `---`。
 */
export const isSafeExtraLine = (line: string): boolean => {
  if (/[\r\n]/.test(line)) return false;
  if (/^---/.test(line)) return false;
  return line.trim() === "" || /^\s/.test(line) || KEY_LINE.test(line);
};

/** YAML 双引号标量：换行转义成 `\n`，避免一行值把结构撑开 */
export const yamlString = (value: string): string =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;

/** 一个 frontmatter 字段的值；数组走 flow 序列，布尔直写，其余加引号 */
export type AssetFieldValue = string | boolean | string[];

export const yamlScalar = (value: AssetFieldValue): string => {
  if (Array.isArray(value)) return `[${value.map(yamlString).join(", ")}]`;
  if (typeof value === "boolean") return String(value);
  return yamlString(value);
};

export type AssetFrontmatterField = readonly [key: string, value: AssetFieldValue];

/** 拼出一份资产文件：建模字段在前，用户自己的行接在后面，正文与 frontmatter 之间留一个空行 */
export const buildAssetFile = (input: {
  fields: readonly AssetFrontmatterField[];
  extraLines: readonly string[];
  body: string;
}): string => {
  const lines = [
    ...input.fields.map(([key, value]) => `${key}: ${yamlScalar(value)}`),
    ...input.extraLines,
  ];
  return `---\n${lines.join("\n")}\n---\n\n${input.body.trim()}\n`;
};

/** 读一份资产文件的 frontmatter 与正文；解析失败由调用方接住（YAML 语法错会抛） */
export const readAssetFrontmatter = (
  content: string,
): { fields: Record<string, unknown>; body: string } => {
  const { frontmatter, body } = parseFrontmatter(content);
  return { fields: frontmatter, body };
};

/** 取字符串字段；空串与非字符串一律当作缺省 */
export const stringField = (fields: Record<string, unknown>, key: string): string | undefined => {
  const value = fields[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

/** 取字符串数组字段：数组原样，字符串按逗号拆（与角色 frontmatter 的两种写法一致） */
export const stringListField = (
  fields: Record<string, unknown>,
  key: string,
): string[] | undefined => {
  const value = fields[key];
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
};

/** 取布尔字段；非布尔值当作缺省 */
export const booleanField = (fields: Record<string, unknown>, key: string): boolean | undefined => {
  const value = fields[key];
  return typeof value === "boolean" ? value : undefined;
};
