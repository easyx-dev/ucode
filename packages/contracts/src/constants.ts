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
 * 会话模式：决定工具集、权限与提示词倾向（见 `plans/agent-tools-and-modes.md`）。
 * `build` 编码（默认）/ `plan` 只出计划 / `ask` 只读问答。
 */
export const SESSION_MODES = ["build", "plan", "ask"] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

/** 新建会话的默认模式 */
export const DEFAULT_SESSION_MODE: SessionMode = "build";

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
 * MCP 服务器的工具暴露方式，取 pi `McpExposure` 的子集：
 * `codemode` 只可从 codemode 脚本调用、不进模型工具声明；`direct` 直接声明给模型；
 * `hidden` 注册但不可达。`deferred` / `codemode-deferred` 依赖 `tool_search`，留到阶段 7b。
 */
export const MCP_EXPOSURES = ["codemode", "direct", "hidden"] as const;

export type McpExposure = (typeof MCP_EXPOSURES)[number];

/** MCP 传输方式：本地进程（stdio）或 HTTP 端点 */
export const MCP_TRANSPORTS = ["stdio", "http"] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/** 新建 MCP 服务器的默认暴露方式：经 codemode 调用，不占用模型工具声明 */
export const DEFAULT_MCP_EXPOSURE: McpExposure = "codemode";

/** 接口版本；破坏性变更时递增，路径前缀与 health 的 apiVersion 都取自它 */
export const API_VERSION = "v1";

/** 对外 HTTP 接口统一前缀 */
export const API_BASE_PATH = `/api/${API_VERSION}`;
