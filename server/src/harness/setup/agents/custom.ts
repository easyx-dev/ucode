/**
 * 自定义角色：从全局 `$APP_HOME/agents/*.md` 与项目配置目录下的 `agents/*.md`
 * （cwd 祖先链，近者优先）发现 primary / subagent 角色（frontmatter + 提示词正文）。
 *
 * 这是运行时数据而非内置声明：坏文件跳过并收集错误，不阻断会话装配；与内置角色同名时覆盖。
 * `mode: primary`（或 `all`）允许占用 `build` / `plan` / `ask` 并覆盖内置；纯 `subagent`
 * （缺省）仍拒绝与主模式同名。frontmatter 复用 pi 的 `parseFrontmatter`，不引入第二套 YAML 依赖。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { type AgentSource, SESSION_MODES, THINKING_LEVELS } from "@ucode/contracts";
import { z } from "zod";

import { CUSTOM_AGENT_MAX_BYTES, CUSTOM_AGENT_SLUG_MAX_LENGTH } from "../../../constants/agents";
import { AGENTS_DIRNAME, PROJECT_CONFIG_DIRNAME } from "../../../constants/dirs";
import { ancestorDirs } from "../../../platform/paths";
import type { PluginAgentFile } from "../../plugins/types";
import { DEFAULT_BUILTIN_TOOLS, DEFAULT_EXTENSION_TOOLS, KNOWN_TOOL_NAMES } from "../tools/names";
import { SUBAGENT_PROFILES } from "./profiles";
import type { AgentCapability, AgentProfile, ToolSelection } from "./types";

/** 采集到的自定义角色错误：文件保留在磁盘上，只有这一个角色被跳过 */
export type CustomAgentError = {
  file: string;
  reason: string;
};

/** 角色注册表：内置打底，自定义按同名覆盖；primary 只含自定义（内置三位隐式存在） */
export type AgentRegistry = {
  primary: Record<string, AgentProfile>;
  subagents: Record<string, AgentProfile>;
  errors: CustomAgentError[];
};

export type AgentRegistryInput = {
  /** 会话工作目录：决定项目配置目录下 `agents` 的祖先链 */
  cwd: string;
  /** `$APP_HOME`：全局 `agents` 的父目录 */
  appHome: string;
  /** 用户主目录（祖先链终点）；缺省取 `os.homedir()`，测试可覆盖 */
  userHome?: string;
  /**
   * 启用插件声明的子角色（由插件宿主解析好、调用方注入）。
   * 插件角色一律是子角色，slug 已带插件前缀，与项目 / 全局角色不会撞名。
   */
  pluginAgents?: readonly PluginAgentFile[];
};

/** 文件名即 slug：小写字母开头、kebab-case，保证能安全用作会话字段与工具入参枚举 */
const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

/** primary 的默认工具集（与内置 build 一致）；subagent 的缺省是继承父会话 */
const buildToolSelection = (): ToolSelection => ({
  kind: "defaultTools",
  defaultTools: [...DEFAULT_BUILTIN_TOOLS, ...DEFAULT_EXTENSION_TOOLS],
});

// 每个字段都自带中文错误：zod 默认走英文，混排文案会漏进日志与设置页
const frontmatterSchema = z
  .object({
    /** 展示名；缺省用文件名 */
    name: z
      .string({ error: "name 必须是字符串" })
      .trim()
      .min(1, { error: "name 不能为空" })
      .optional(),
    /** 角色说明；写进工具描述与选择器，供模型 / 用户挑选 */
    description: z
      .string({ error: "description 必填，且必须是字符串" })
      .trim()
      .min(1, { error: "description 不能为空" }),
    /** 角色类别；缺省 subagent（沿用既有语义） */
    mode: z.enum(["primary", "subagent", "all"], { error: "mode 取值非法" }).optional(),
    /** 工具档位：subagent 缺省或 `inherit` 继承父会话；primary 缺省为默认工具集 */
    tools: z
      .union(
        [
          z.string({ error: "tools 必须是字符串" }),
          z.array(z.string({ error: "tools 的每一项必须是字符串" }), {
            error: "tools 必须是字符串数组",
          }),
        ],
        {
          error: "tools 必须是字符串或字符串数组",
        },
      )
      .optional(),
    /** 缺省继承父会话的模型 */
    model: z
      .string({ error: "model 必须是字符串" })
      .trim()
      .min(1, { error: "model 不能为空" })
      .optional(),
    /** 本模式的推荐思考档位；只对 primary 角色有效（子会话的档位按所属模式解析） */
    thinking: z.enum(THINKING_LEVELS, { error: "thinking 取值非法" }).optional(),
    /** subagent 是否列进工具描述；缺省列出，`false` 表示隐藏但仍可按名调用 */
    advertise: z.boolean({ error: "advertise 必须是布尔值" }).optional(),
    /** primary 是否对选择器隐藏；缺省显示，`true` 表示隐藏但仍可按名调用 */
    hidden: z.boolean({ error: "hidden 必须是布尔值" }).optional(),
  })
  // 未知键一律报错：`tool:` / 全角冒号这类拼写错误若被静默丢弃，`tools` 会退回继承，
  // 等于把用户想收窄的能力放大成继承父会话，方向最危险的一侧必须挡住
  .strict();

type CustomAgentFrontmatter = z.infer<typeof frontmatterSchema>;

export type CustomAgentMode = "primary" | "subagent" | "all";

export type ParsedCustomAgent = { mode: CustomAgentMode; profile: AgentProfile };

/** 解析 `tools`：空 / `inherit` 继承父能力（仅 subagent），否则收成白名单 */
const parseToolSelection = (
  value: string | string[] | undefined,
  mode: CustomAgentMode,
): ToolSelection | { kind: "inherit" } => {
  if (value === undefined) {
    return mode === "subagent" ? { kind: "inherit" } : buildToolSelection();
  }
  const raw = (Array.isArray(value) ? value : value.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  if (raw.length === 0) return mode === "subagent" ? { kind: "inherit" } : buildToolSelection();
  if (raw.includes("inherit")) {
    if (raw.length > 1) throw new Error("tools 不能同时声明 inherit 与具体工具名");
    if (mode !== "subagent") throw new Error("primary 角色不支持 tools: inherit");
    return { kind: "inherit" };
  }

  const names = [...new Set(raw)];
  const unknown = names.filter((name) => !KNOWN_TOOL_NAMES.has(name));
  if (unknown.length > 0) throw new Error(`tools 含未知工具名：${unknown.join(" / ")}`);
  return { kind: "allowlist", tools: names };
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
export const parseCustomAgent = (slug: string, content: string): ParsedCustomAgent => {
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

  const mode: CustomAgentMode = fields.mode ?? "subagent";
  const kind = mode === "subagent" ? "subagent" : "primary";
  // 档位按「本会话模式」解析，子角色没有自己的推荐值：显式拒绝好过静默忽略
  if (kind === "subagent" && fields.thinking) {
    throw new Error("subagent 角色不能声明 thinking（子会话的档位按所属模式解析）");
  }
  const capability = {
    toolSelection: parseToolSelection(fields.tools, mode),
    permissions: [],
    ...(fields.model ? { model: fields.model } : {}),
  };

  const profile: AgentProfile = {
    slug,
    kind,
    label: fields.name ?? slug,
    description: fields.description,
    promptSection,
    ...(kind === "primary" && fields.thinking ? { recommendedThinkingLevel: fields.thinking } : {}),
    capability,
    ...(fields.advertise === false ? { advertise: false } : {}),
    ...(fields.hidden ? { hidden: true } : {}),
  };

  return { mode, profile };
};

/** 校验文件名可用作 slug（长度与字符集） */
const assertUsableSlug = (slug: string): void => {
  if (!SLUG_PATTERN.test(slug) || slug.length > CUSTOM_AGENT_SLUG_MAX_LENGTH) {
    throw new Error("文件名需为小写字母开头、仅含小写字母 / 数字 / 连字符的 slug");
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** 角色目录链：项目配置目录下的 `agents`（近→远）+ 全局 `$APP_HOME/agents`，去重且只留存在的 */
const agentDirs = (input: AgentRegistryInput): Array<{ dir: string; source: AgentSource }> => {
  const userHome = resolve(input.userHome ?? homedir());
  const appHome = resolve(input.appHome);
  const candidates: Array<{ dir: string; source: AgentSource }> = [];

  for (const dir of ancestorDirs(input.cwd, [userHome])) {
    if (dir === userHome || dir === appHome) continue;
    candidates.push({
      dir: resolve(dir, PROJECT_CONFIG_DIRNAME, AGENTS_DIRNAME),
      source: "project",
    });
  }
  candidates.push({ dir: resolve(appHome, AGENTS_DIRNAME), source: "global" });

  const seen = new Set<string>();
  return candidates.filter(({ dir }) => {
    const path = resolve(dir);
    if (seen.has(path) || !isDirectory(path)) return false;
    seen.add(path);
    return true;
  });
};

/** 目录下的普通 `.md` 文件（符号链接不进角色目录，避免指到 .env 等无关文件） */
const listAgentFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

/** 载入一个角色文件并按 mode 归位；返回错误原因或 null */
const placeAgent = (
  registry: { primary: Record<string, AgentProfile>; subagents: Record<string, AgentProfile> },
  seen: { primary: Set<string>; subagent: Set<string> },
  slug: string,
  content: string,
  source: AgentSource,
): void => {
  const { mode, profile } = parseCustomAgent(slug, content);
  const tagged: AgentProfile = { ...profile, source };

  if (mode === "subagent") {
    if ((SESSION_MODES as readonly string[]).includes(slug)) {
      throw new Error(`与主模式同名：${slug}`);
    }
    if (!seen.subagent.has(slug)) {
      registry.subagents[slug] = tagged;
      seen.subagent.add(slug);
    }
    return;
  }

  if (!seen.primary.has(slug)) {
    registry.primary[slug] = tagged;
    seen.primary.add(slug);
  }
  if (mode === "all" && !seen.subagent.has(slug)) {
    registry.subagents[slug] = { ...tagged, kind: "subagent" };
    seen.subagent.add(slug);
  }
};

/**
 * 工具档位：显式白名单优先；只给了黑名单时按「已知工具减去它」算白名单；
 * 两者都没有则继承父会话（`inherit` 会与父能力取交集，不会放大）。
 */
const pluginToolSelection = (agent: PluginAgentFile): AgentCapability["toolSelection"] => {
  if (agent.tools.length > 0) {
    const allowed = agent.tools.filter((tool) => KNOWN_TOOL_NAMES.has(tool));
    return allowed.length > 0 ? { kind: "allowlist", tools: allowed } : { kind: "inherit" };
  }
  if (agent.disallowedTools.length > 0) {
    const denied = new Set(agent.disallowedTools);
    return { kind: "allowlist", tools: [...KNOWN_TOOL_NAMES].filter((tool) => !denied.has(tool)) };
  }
  return { kind: "inherit" };
};

/** 插件角色落位：一律子角色，来源标 `plugin` */
const placePluginAgent = (
  registry: AgentRegistry,
  seen: { subagent: Set<string> },
  agent: PluginAgentFile,
): void => {
  if (seen.subagent.has(agent.slug)) return;
  registry.subagents[agent.slug] = {
    slug: agent.slug,
    kind: "subagent",
    label: agent.label,
    description: agent.description,
    promptSection: agent.promptSection,
    capability: {
      toolSelection: pluginToolSelection(agent),
      permissions: [],
      ...(agent.model ? { model: agent.model } : {}),
    },
    source: "plugin",
  };
  seen.subagent.add(agent.slug);
};

/**
 * 加载角色注册表：内置打底，逐个合并角色文件（项目近者优先，其次全局），最后并入插件角色。
 * 目录不存在等于没有自定义角色；单个文件失败只记入 `errors`，不影响其余角色。
 */
export const loadAgentRegistry = (input: AgentRegistryInput): AgentRegistry => {
  const registry: AgentRegistry = {
    primary: {},
    subagents: { ...SUBAGENT_PROFILES },
    errors: [],
  };
  const seen = { primary: new Set<string>(), subagent: new Set<string>() };

  for (const { dir, source } of agentDirs(input)) {
    for (const file of listAgentFiles(dir)) {
      const slug = file.slice(0, -".md".length);
      const path = join(dir, file);
      try {
        assertUsableSlug(slug);
        // 先按文件大小挡一道，再读取，避免超大文件整块进内存
        if (statSync(path).size > CUSTOM_AGENT_MAX_BYTES) throw new Error("文件过大");
        placeAgent(registry, seen, slug, readFileSync(path, "utf8"), source);
      } catch (error) {
        registry.errors.push({
          file,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // 插件角色排在最后：slug 带前缀，与上面两档不会撞名；万一撞了就保留先到者
  for (const agent of input.pluginAgents ?? []) placePluginAgent(registry, seen, agent);

  return registry;
};

/**
 * 全部可用子角色，保持注册顺序（内置在前，自定义按文件名排序）。
 * `advertise` 只影响是否写进工具描述，由工具层过滤；调用方必须传全量，
 * 否则被隐藏的角色会连入参枚举都进不去、变成不可调用。
 */
export const allSubagents = (registry: AgentRegistry): AgentProfile[] =>
  Object.values(registry.subagents);
