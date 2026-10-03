/**
 * 自定义子角色：从 `<agentDir>/agents/*.md` 发现角色（frontmatter + 提示词正文）。
 *
 * 这是运行时数据而非内置声明：坏文件跳过并收集错误，不阻断会话装配；与内置子角色同名时覆盖，
 * 但与主模式（build / plan / ask）同名一律拒绝——主模式由契约枚举锁定，自定义角色只作子会话能力来源。
 * frontmatter 复用 pi 的 `parseFrontmatter`，不引入第二套 YAML 依赖。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { SESSION_MODES, THINKING_LEVELS } from "@ucode/contracts";
import { z } from "zod";

import {
  AGENTS_DIRNAME,
  CUSTOM_AGENT_MAX_BYTES,
  CUSTOM_AGENT_SLUG_MAX_LENGTH,
} from "../../constants";
import { KNOWN_TOOL_NAMES } from "../tools/names";
import { SUBAGENT_PROFILES } from "./profiles";
import type { AgentProfile, ToolSelection } from "./types";

/** 采集到的自定义角色错误：文件保留在磁盘上，只有这一个角色被跳过 */
export type CustomAgentError = {
  file: string;
  reason: string;
};

/** 子角色注册表：内置打底，自定义按同名覆盖；主模式不在这里 */
export type AgentRegistry = {
  subagents: Record<string, AgentProfile>;
  errors: CustomAgentError[];
};

/** 文件名即 slug：小写字母开头、kebab-case，保证能安全用作会话字段与工具入参枚举 */
const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

// 每个字段都自带中文错误：zod 默认走英文，混排文案会漏进日志与后续设置页
const frontmatterSchema = z
  .object({
    /** 展示名；缺省用文件名 */
    name: z
      .string({ error: "name 必须是字符串" })
      .trim()
      .min(1, { error: "name 不能为空" })
      .optional(),
    /** 角色说明；写进 `subagent` 工具描述，供模型挑选 */
    description: z
      .string({ error: "description 必填，且必须是字符串" })
      .trim()
      .min(1, { error: "description 不能为空" }),
    /** 工具档位：缺省或 `inherit` 继承父会话；否则为工具名清单（逗号分隔或数组） */
    tools: z
      .union(
        [
          z.string({ error: "tools 必须是字符串" }),
          z.array(z.string({ error: "tools 的每一项必须是字符串" }), {
            error: "tools 必须是字符串数组",
          }),
        ],
        { error: "tools 必须是字符串或字符串数组" },
      )
      .optional(),
    /** 缺省继承父会话的模型 */
    model: z
      .string({ error: "model 必须是字符串" })
      .trim()
      .min(1, { error: "model 不能为空" })
      .optional(),
    /** 缺省继承父会话的思考档位 */
    thinking: z.enum(THINKING_LEVELS, { error: "thinking 取值非法" }).optional(),
    /** 是否列进工具描述；缺省列出，`false` 表示隐藏但仍可按名调用 */
    advertise: z.boolean({ error: "advertise 必须是布尔值" }).optional(),
  })
  // 未知键一律报错：`tool:` / 全角冒号这类拼写错误若被静默丢弃，`tools` 会退回 `inherit`，
  // 等于把用户想收窄的能力放大成继承父会话，方向最危险的一侧必须挡住
  .strict();

type CustomAgentFrontmatter = z.infer<typeof frontmatterSchema>;

/** 解析 `tools`：空 / `inherit` 继承父能力，否则收成白名单（交集在装配时再算） */
const parseToolSelection = (
  value: string | string[] | undefined,
): ToolSelection | { kind: "inherit" } => {
  if (value === undefined) return { kind: "inherit" };
  const raw = (Array.isArray(value) ? value : value.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  if (raw.length === 0) return { kind: "inherit" };
  if (raw.includes("inherit")) {
    if (raw.length > 1) throw new Error("tools 不能同时声明 inherit 与具体工具名");
    return { kind: "inherit" };
  }

  const names = [...new Set(raw)];
  const unknown = names.filter((name) => !KNOWN_TOOL_NAMES.has(name));
  if (unknown.length > 0) throw new Error(`tools 含未知工具名：${unknown.join(" / ")}`);
  return { kind: "allowlist", tools: names };
};

/** 校验文件名可用作 slug；主模式名保留给契约，不被自定义角色占用 */
const assertUsableSlug = (slug: string): void => {
  if (!SLUG_PATTERN.test(slug) || slug.length > CUSTOM_AGENT_SLUG_MAX_LENGTH) {
    throw new Error("文件名需为小写字母开头、仅含小写字母 / 数字 / 连字符的 slug");
  }
  if ((SESSION_MODES as readonly string[]).includes(slug)) {
    throw new Error(`与主模式同名：${slug}`);
  }
};

const parseFrontmatterFields = (frontmatter: Record<string, unknown>): CustomAgentFrontmatter => {
  const parsed = frontmatterSchema.safeParse(frontmatter);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) =>
        issue.code === "unrecognized_keys"
          ? `frontmatter 含未知字段：${issue.keys.join(" / ")}`
          : `${issue.path.join(".") || "frontmatter"}：${issue.message}`,
      )
      .join("；");
    throw new Error(`frontmatter 非法（${reason}）`);
  }
  return parsed.data;
};

/** 解析单个角色文件；任何一步失败都抛出可读原因，由调用方收集 */
export const parseCustomAgent = (slug: string, content: string): AgentProfile => {
  // pi 对「缺结束分隔符」的 frontmatter 视同没有 frontmatter，报错会指到 description 上，
  // 与真实原因不符；这里先给出准确提示（判定与 pi 的 extractFrontmatter 对齐）
  const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (/^---\r?\n/.test(normalized) && normalized.indexOf("\n---", 3) === -1) {
    throw new Error("frontmatter 起始的 `---` 缺少对应的结束 `---`");
  }

  const { frontmatter, body } = parseFrontmatter(content);
  const fields = parseFrontmatterFields(frontmatter);
  const promptSection = body.trim();
  if (!promptSection) throw new Error("缺少提示词正文");

  const capability = {
    toolSelection: parseToolSelection(fields.tools),
    permissions: [],
    ...(fields.model ? { model: fields.model } : {}),
    ...(fields.thinking ? { thinkingLevel: fields.thinking } : {}),
  };

  return {
    slug,
    kind: "subagent",
    label: fields.name ?? slug,
    description: fields.description,
    promptSection,
    capability,
    ...(fields.advertise === false ? { advertise: false } : {}),
  };
};

/**
 * 加载子角色注册表：内置打底，逐个合并 `agents/*.md`。
 * 目录不存在等于没有自定义角色；单个文件失败只记入 `errors`，不影响其余角色。
 */
export const loadAgentRegistry = (agentDir: string): AgentRegistry => {
  const subagents: Record<string, AgentProfile> = { ...SUBAGENT_PROFILES };
  const errors: CustomAgentError[] = [];
  const dir = join(agentDir, AGENTS_DIRNAME);

  let files: string[];
  try {
    // 只认普通文件：符号链接（可能指向 .env 等无关文件）不进角色目录
    files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch {
    return { subagents, errors };
  }

  for (const file of files.sort()) {
    const slug = file.slice(0, -".md".length);
    const path = join(dir, file);
    try {
      assertUsableSlug(slug);
      // 先按文件大小挡一道，再读取，避免超大文件整块进内存
      if (statSync(path).size > CUSTOM_AGENT_MAX_BYTES) throw new Error("文件过大");
      subagents[slug] = parseCustomAgent(slug, readFileSync(path, "utf8"));
    } catch (error) {
      errors.push({ file, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { subagents, errors };
};

/**
 * 全部可用子角色，保持注册顺序（内置在前，自定义按文件名排序）。
 * `advertise` 只影响是否写进工具描述，由工具层过滤；调用方必须传全量，
 * 否则被隐藏的角色会连入参枚举都进不去、变成不可调用。
 */
export const allSubagents = (registry: AgentRegistry): AgentProfile[] =>
  Object.values(registry.subagents);
