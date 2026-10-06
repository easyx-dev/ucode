/** 跨端共享常量：模型目录与校验都从这里取值，避免前后端各写一份枚举 */

/** pi 支持的 API 类型（与 pi-ai 的 KnownApi 对齐，pi 的供应商目录里都会出现） */
export const API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
  "openai-codex-responses",
  "bedrock-converse-stream",
  "google-vertex",
  "pi-messages",
] as const;

export type ApiType = (typeof API_TYPES)[number];

/** pi-agent-core 的 ThinkingLevel */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 文件系统条目类型；fs/list 的 `entries[].type` 取值 */
export const FS_ENTRY_TYPES = ["file", "directory"] as const;

export type FsEntryType = (typeof FS_ENTRY_TYPES)[number];

/** fs/list 的条目过滤；`all` 表示不过滤 */
export const FS_LIST_FILTERS = ["all", ...FS_ENTRY_TYPES] as const;

export type FsListFilter = (typeof FS_LIST_FILTERS)[number];

/** 消息角色；响应用枚举，与 pi 的 AgentMessage 角色对齐（system 等内部角色不下发） */
export const MESSAGE_ROLES = ["user", "assistant", "tool", "custom", "summary"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

/**
 * 忽略本次计划的界面标记：plan 模式的决策表单点「忽略」后，服务端往会话文件追加的
 * pi `custom` 条目（`data.at` 是忽略时间）。跨端常量——服务端写、各端据此渲染「已忽略计划」，
 * 并让本轮不再弹表单。它只作扩展状态持久化，不进模型上下文。
 */
export const PLAN_IGNORED_CUSTOM_TYPE = "ucode.plan-ignored";

/**
 * 会话模式：决定工具集、权限与提示词倾向（见 `plans/agent-tools-and-modes.md`）。
 * `build` 编码（默认）/ `plan` 只出计划 / `ask` 只读问答。
 *
 * 这里是**内置默认集合**：`sessions` 的 `mode` 是字符串 slug，允许自定义 primary agent
 * 覆盖同名内置项或另取新名，服务端按 agent 注册表校验（见 `plans/input-commands-skills.md`）。
 */
export const SESSION_MODES = ["build", "plan", "ask"] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

/** 新建会话的默认模式 */
export const DEFAULT_SESSION_MODE: SessionMode = "build";

/**
 * 目标模式的状态：`active` 自动推进 / `paused` 已暂停（`cause` 说明原因）/
 * `completed` 已达成。只有 `active` 才会触发自动续跑。
 */
export const GOAL_STATUSES = ["active", "paused", "completed"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

/**
 * 目标暂停的原因：用户主动暂停 / 切走 build 模式 / 当前轮被中断 /
 * 连续无进展 / 达到轮数上限 / 达到 token 预算 / 生成出错。
 */
export const GOAL_PAUSE_CAUSES = [
  "user",
  "mode",
  "interrupted",
  "no_progress",
  "limit",
  "budget",
  "error",
] as const;

export type GoalPauseCause = (typeof GOAL_PAUSE_CAUSES)[number];

/** 目标描述的字符上限；与 Codex / pi-goal 的 4000 一致 */
export const GOAL_MAX_OBJECTIVE_LENGTH = 4000;

/**
 * 权限动作三态：`allow` 直接放行 / `ask` 交由用户确认 / `deny` 阻断。
 * 规则按工具名分键、pattern 匹配，**最后命中者胜**；未命中任何规则时默认 `allow`。
 */
export const PERMISSION_ACTIONS = ["allow", "ask", "deny"] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * 用户对审批请求的答复：`allow_once` 只放行本次 / `allow_session` 本会话恒允 / `deny` 拒绝。
 * 「本会话恒允」只存进程内存，删会话时清理，服务重启回到规则默认。
 */
export const PERMISSION_DECISIONS = ["allow_once", "allow_session", "deny"] as const;

export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

/**
 * 会话级权限档位：决定命中 `ask` 的调用是弹审批还是自动放行。
 * `default` 全部按规则 / `auto` 自动批准常规工具（越界目录仍审批）/
 * `full` 所有 `ask` 放行（越界目录也放行）。三者都**只放宽 `ask`**，`deny` 永不突破。
 */
export const PERMISSION_MODES = ["default", "auto", "full"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** 新建会话的默认权限档位；最放行档必须由用户显式选择 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "default";

/**
 * 联网搜索服务商：websearch 工具的可选实现，顺序即设置页的展示顺序。
 * 每家在 server 侧对应一个 `SearchProvider`（端点、鉴权与响应映射都不同）。
 */
export const SEARCH_PROVIDERS = ["tavily", "searxng", "brave"] as const;

export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number];

/** 新建会话/默认配置使用的搜索服务商：Tavily 有免绑卡的免费额度，是门槛最低的一家 */
export const DEFAULT_SEARCH_PROVIDER: SearchProviderId = "tavily";

/** 需要自建实例、不需要 key 的服务商：前端据此切换「实例地址 / API Key」字段 */
export const KEYLESS_SEARCH_PROVIDERS = ["searxng"] as const satisfies readonly SearchProviderId[];

/** 服务商展示名：都是专有名词，不随语言翻译 */
export const SEARCH_PROVIDER_LABELS: Record<SearchProviderId, string> = {
  tavily: "Tavily",
  searxng: "SearXNG",
  brave: "Brave",
};

/**
 * MCP 服务器的工具暴露方式，与 pi `McpExposure` 对齐：
 * `codemode` 只可从 codemode 脚本调用、不进模型工具声明，由脚本按需检索；`deferred` 由 `tool_search`
 * 检索后声明给模型；`direct` 直接声明给模型；`hidden` 注册但不可达。
 */
export const MCP_EXPOSURES = ["codemode", "deferred", "direct", "hidden"] as const;

export type McpExposure = (typeof MCP_EXPOSURES)[number];

/** MCP 传输方式：本地进程（stdio）或 HTTP 端点 */
export const MCP_TRANSPORTS = ["stdio", "http"] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** 新建 MCP 服务器的默认暴露方式：经 codemode 调用，不占用模型工具声明 */
export const DEFAULT_MCP_EXPOSURE: McpExposure = "codemode";

/** 图片输入类型；与 pi 的 vision 输入对齐（`read` 工具与 prompt 附件共用） */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** 附件类别：图片会作为 vision 内容块发给模型，其余（pdf/word 等）本期只存与引用 */
export const ATTACHMENT_KINDS = ["image", "file"] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** 单张附件的上传体积上限；客户端预检 + 服务端兜底 */
export const ATTACHMENT_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** 单轮 prompt 的附件数量上限；超出直接 400，避免请求体过大 */
export const PROMPT_MAX_ATTACHMENTS = 8;

/** 单轮 prompt 的 `@` 上下文引用数量上限 */
export const PROMPT_MAX_CONTEXTS = 32;

/**
 * 命令与技能的来源，**数组顺序即同名优先级**（前者胜）：
 * 项目 `.ucode` → 项目 `.agents` → 全局 `$APP_HOME` → 用户 `~/.agents`。
 * 提示词命令只会有 `project` / `global` 两种。
 */
export const COMMAND_ASSET_SOURCES = [
  "project",
  "agents-project",
  "global",
  "agents-user",
] as const;

export type CommandAssetSource = (typeof COMMAND_ASSET_SOURCES)[number];

/** 角色类别：primary 作会话主 agent，subagent 由 `subagent` 工具委派 */
export const AGENT_KINDS = ["primary", "subagent"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

/** 角色来源：内置 / 项目 `.ucode` / 全局 `$APP_HOME`（自定义 subagent 与 primary 共用） */
export const AGENT_SOURCES = ["builtin", "project", "global"] as const;

export type AgentSource = (typeof AGENT_SOURCES)[number];

/** 接口版本；破坏性变更时递增，路径前缀与 health 的 apiVersion 都取自它 */
export const API_VERSION = "v1";

/** 对外 HTTP 接口统一前缀 */
export const API_BASE_PATH = `/api/${API_VERSION}`;
