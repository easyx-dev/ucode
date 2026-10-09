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

/** fs/read 的读取形态：文本按 UTF-8 给内容，二进制给 base64 */
export const FS_READ_KINDS = ["text", "binary"] as const;

export type FsReadKind = (typeof FS_READ_KINDS)[number];

/** 单文件读取的体积上限（请求 `maxBytes` 不得超过）；服务端另有各自的文本 / 二进制内联上限 */
export const FS_READ_MAX_BYTES = 8 * 1024 * 1024;

/** git 变更条目的状态；`renamed` / `copied` 会带上原路径 */
export const GIT_FILE_STATUSES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typeChanged",
  "conflicted",
] as const;

export type GitFileStatus = (typeof GIT_FILE_STATUSES)[number];

/** git diff 的对比来源：工作区与 index、index 与 HEAD、某次提交与它的父提交 */
export const GIT_DIFF_SOURCES = ["worktree", "staged", "commit"] as const;

export type GitDiffSource = (typeof GIT_DIFF_SOURCES)[number];

/** git diff 行的类型：上下文 / 新增 / 删除 */
export const GIT_DIFF_LINE_KINDS = ["ctx", "add", "del"] as const;

export type GitDiffLineKind = (typeof GIT_DIFF_LINE_KINDS)[number];

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
 * 权限审批记录：每次真正弹过审批的调用（`ask` 规则或越界检查）决定后，服务端往会话文件追加的
 * pi `custom` 条目（`data` 为 `{tool, subject, scope, decision}`）。跨端常量——服务端写、各端据此
 * 回放「当时确认过什么」，只作扩展状态持久化，不进模型上下文。
 */
export const PERMISSION_DECISION_CUSTOM_TYPE = "ucode.permission-decision";

/**
 * 每步耗时记录：每次模型往返结束后，服务端往会话文件追加的 pi `custom` 条目。
 * `data` 为 `{turn, startedAt, firstEventAt, firstTokenAt, respondedAt, endedAt, firstEventMs, ttftMs,
 * streamMs, toolMs, userWaitMs, toolCalls, toolNames, hasText, inputTokens, cacheReadTokens,
 * outputTokens, reasoningTokens, contextTokens, contextBudget, thinkingLevel, attachments}`——
 * 把「一次往返」拆成响应头 / 首字节 / 解码 / 工具四段，外加等用户的时间，供事后算账。
 * 它只作服务端观测：既不进模型上下文，也不下发给客户端
 * （见 `core/serialize` 的 customType 白名单）。
 */
export const STEP_RECORD_CUSTOM_TYPE = "ucode.step";

/**
 * 委派记录：父会话里一次 `subagent` 调用的建立与结束，服务端往父会话文件追加的
 * pi `custom` 条目，`data` 为 `SubagentRecord`。
 *
 * 子会话自己的文件只记它干了什么，看不出「谁把它派出来、为什么任务、结果算是成功还是超时」；
 * 子会话被归档后更是只剩这条。只为回溯：不进模型上下文，也不下发客户端。
 */
export const SUBAGENT_RECORD_CUSTOM_TYPE = "ucode.subagent";

export type SubagentRecord = {
  /** `start` 建立、`end` 结束 */
  event: "start" | "end";
  /** 子会话 id */
  childId: string;
  /** 父会话里这次调用的 id */
  toolCallId: string;
  /** 子角色 slug 与当时起的名字 */
  agent?: string;
  name?: string;
  /** 结束时的结果：失败 / 被中止（超时也走失败） */
  isError?: boolean;
  aborted?: boolean;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};

/**
 * 挂起交互的结算记录：一次权限审批 / 提问从挂起到有结论，服务端往会话文件追加的
 * pi `custom` 条目，`data` 为 `InteractionRecord`。
 *
 * `ucode.permission-decision` 只记权限审批的结论，且由客户端回传；忽略 / 失效 / 中止导致的
 * 结算没有来源可回传，只能由服务端自己记。只为回溯：不进模型上下文，也不下发客户端。
 */
export const INTERACTION_RECORD_CUSTOM_TYPE = "ucode.interaction";

export type InteractionRecord = {
  /** 交互类型：权限审批 / 提问 */
  kind: "permission" | "question";
  requestId: string;
  /** 结算方式：有答复、被忽略、会话结束 / 中止 */
  outcome: "resolved" | "dismissed" | "aborted";
  /** 该交互的来源会话（子会话发起时不是当前会话） */
  sourceSessionId?: string;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};

/**
 * 记忆回顾记录：后台回顾固化了一条项目记忆，服务端往会话文件追加的 pi `custom` 条目，
 * `data` 为 `MemoryReviewRecord`。
 *
 * 记忆文件本身不带会话，事后说不清「这条记忆是从哪次交流里来的」。只为回溯：
 * 不进模型上下文，也不下发客户端。
 */
export const MEMORY_REVIEW_RECORD_CUSTOM_TYPE = "ucode.memory-review";

export type MemoryReviewRecord = {
  /** 固化的记忆文件名（项目记忆目录下） */
  file: string;
  /** 记忆标题 */
  title: string;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};

/**
 * 模式 / 权限档位的变更记录：服务端往会话文件追加的 pi `custom` 条目，`data` 为 `ModeRecord`。
 *
 * 两者都决定每轮的工具集与审批口径（编码 / 计划 / 提问、默认 / 全允 / 只读），换了什么、
 * 什么时候换的没有别的地方记，客户端按它渲染一条细线。
 */
export const MODE_RECORD_CUSTOM_TYPE = "ucode.mode";

export type ModeRecord = {
  /** 变更后的模式（编码 / 计划 / 提问）；只改权限档位时没有 */
  mode?: string;
  /** 变更后的权限档位 */
  permissionMode?: string;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};

/**
 * 旧工具输出清理（prune）的记录：清掉哪些条目、省了多少 token，服务端往会话文件追加的
 * pi `custom` 条目，`data` 为 `PruneRecord`。
 *
 * `context_edit` 只说明「某条被换成了占位」，看不出是谁在什么时候清的、一次清了几个；
 * 上下文规模突然掉一截时，这条是唯一的账目。只为回溯：不进模型上下文，也不下发客户端。
 */
export const PRUNE_RECORD_CUSTOM_TYPE = "ucode.prune";

export type PruneRecord = {
  /** 被清理的条目数 */
  cleared: number;
  /** 估算腾出的 token 数 */
  freedTokens: number;
  /** 被清掉的条目：id 与当时的工具名 */
  targets: Array<{ id: string; tool: string }>;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};

/**
 * 目标记录：目标状态每次变迁（设定 / 暂停 / 恢复 / 清除）与每轮校验结论，服务端往会话文件
 * 追加的 pi `custom` 条目，`data` 为 `GoalRecord`。
 *
 * 补的是存储态看不到的历史：`goal_state` 只有当前值，校验走一次模型调用却只在下一轮注入里
 * 出现一次（上下文一压就没了）。跨端常量——服务端写，界面只展示「目标完成」那一条，
 * 其余留在文件里供回溯；它不进模型上下文。
 */
export const GOAL_RECORD_CUSTOM_TYPE = "ucode.goal";

/** 目标状态变迁的种类（`GoalRecord.event`，除 `verdict` / `completed` 外与操作一一对应） */
export const GOAL_RECORD_EVENTS = [
  "set",
  "pause",
  "resume",
  "clear",
  "verdict",
  "completed",
] as const;

export type GoalRecordEvent = (typeof GOAL_RECORD_EVENTS)[number];

/**
 * 目标记录的 payload。字段按事件可选：状态变迁带 `status` / `cause`，校验与完成带 `verdict`。
 */
export type GoalRecord = {
  event: GoalRecordEvent;
  /** 本次事件后的状态（`clear` 时缺省） */
  status?: "active" | "paused" | "completed";
  /** `pause` 专用：暂停原因 */
  cause?: GoalPauseCause;
  /** 目标激活后累计的轮数 */
  turns?: number;
  /** 校验结论；`verdict` 与 `completed` 都带 */
  verdict?: { achieved: boolean; reason: string; nextStep: string };
  /** 本轮的用量累计（token）；存储态只给当前值，历史需要自己带 */
  tokensUsed?: number;
  /** 目标正文；只在 `set` 时带，其余从存储态能看出 */
  objective?: string;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};

/**
 * 目标指令的注入来源：启动 / 续跑 / 恢复（`details.kind`）。
 * 这三种都是合成输入，用 `custom_message` 落地，不再伪装成用户消息。
 */
export const GOAL_PROMPT_KINDS = ["kickoff", "continuation", "resume"] as const;

export type GoalPromptKind = (typeof GOAL_PROMPT_KINDS)[number];

/** 目标指令的 `custom_message` 类型与 `details` */
export const GOAL_PROMPT_CUSTOM_TYPE = "ucode.goal-prompt";

export type GoalPromptDetails = {
  kind: GoalPromptKind;
  /** 续跑专用：这是目标激活后的第几轮 */
  turn?: number;
};

/**
 * 计划批准后的合成输入（`custom_message`）：原先由客户端发一条「计划已批准，请开始执行。」的
 * 用户消息，同样不是用户打的字，改成服务端注入并标出来源。
 */
export const PLAN_APPROVED_CUSTOM_TYPE = "ucode.plan-approved";

/**
 * 压缩记录：每次真正跑过压缩（手动或自动）后，服务端往会话文件追加的 pi `custom` 条目。
 * `data` 为 `CompactionRecord`（触发来源 / 结局 / 规模 / 跳过或失败的原因）。
 *
 * 它补的是 pi 那个 `compaction` 条目看不到的信息：触发来源、**跳过与失败**（那两种情况压根没有
 * pi 条目，以前只发一条 SSE 提示，刷新就没）。跨端常量——服务端写，各端据此在对话里渲染压缩分隔行，
 * 它只作扩展状态持久化，不进模型上下文。
 */
export const COMPACTION_RECORD_CUSTOM_TYPE = "ucode.compaction";

/** 压缩的触发来源：手动 / 到了阈值 / 逼近窗口 */
export const COMPACTION_REASONS = ["manual", "threshold", "overflow"] as const;

export type CompactionReason = (typeof COMPACTION_REASONS)[number];

/** 一次压缩的结局：真正压了 / 正常拒绝 / 失败 */
export const COMPACTION_OUTCOMES = ["done", "skipped", "failed"] as const;

export type CompactionOutcome = (typeof COMPACTION_OUTCOMES)[number];

/**
 * 压缩记录的 payload。
 *
 * `done` 带规模（`tokensBefore` 压缩前的占用、`tokensAfter` pi 给的压缩后估算）与保留区间起点；
 * `skipped` 带 `CompactionSkipReason`；`failed` 带 pi 的原始原因。
 */
export type CompactionRecord = {
  reason: CompactionReason;
  outcome: CompactionOutcome;
  /** 压缩前的上下文占用（token） */
  tokensBefore?: number;
  /** 压缩后的估算占用（token）；pi 拿不到时省略 */
  tokensAfter?: number;
  /** 保留区间的起点条目 id（压缩后模型还看得到的部分从这里开始） */
  keptFrom?: string;
  /** `skipped` 专用：正常拒绝的原因 */
  skip?: CompactionSkipReason;
  /** `failed` 专用：pi 给的原始失败原因 */
  error?: string;
  /** 写入时刻（ISO 8601 UTC） */
  at: string;
};

/**
 * 手动压缩被**正常拒绝**（不是失败）的原因：
 * - `too_small`：上下文里没有可总结的跨度（pi 的保留预算里装得下全部内容）；
 * - `already_compacted`：路径上已经是压缩后的状态，没有新内容可压。
 *
 * 两者都不该当错误看——没做任何事，也不改变会话状态，界面只给一条轻提示。
 * 跨端常量：服务端识别（走 `compaction_end` 的 `skipped`），客户端据此挑文案。
 */
export const COMPACTION_SKIP_REASONS = ["too_small", "already_compacted"] as const;

export type CompactionSkipReason = (typeof COMPACTION_SKIP_REASONS)[number];

/**
 * 一次压缩的结果提示：成功不需要提示（可见历史会自己收缩成摘要 + 保留区间），
 * 下面两类才需要告知用户——它们都没改变历史，但用户得知道为什么。
 *
 * `skipped` 是正常拒绝（没做任何事）；`failed` 是**自动压缩**没压下去（带 pi 的原始原因）：
 * 它不中断这一轮，但上下文已经逼近窗口，下一轮多半直接报超窗错，不提示的话用户只能看到那个错。
 */
export type CompactionNotice =
  | { kind: "skipped"; reason: CompactionSkipReason }
  | { kind: "failed"; reason: string }
  /** 会话还在跑这一轮：等它结束再压即可，不是失败，也不该占错误横幅 */
  | { kind: "busy" };

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
 * 会话的对外状态（`SessionSummary.status`）：侧栏与通知据此展示中间态。
 *
 * `idle` 已完成 / `running` 生成中 / `waiting_*` 等待用户输入（按挂起请求的类别细分）/
 * `error` 本轮出错。与 `running` 的分工：`running` 是「有活跃生成」的粗粒度布尔，
 * 等待授权或回答时仍为真（这一轮并未释放），`status` 才是需要用户动作的那几个态。
 */
export const SESSION_STATUSES = [
  "idle",
  "running",
  "waiting_permission",
  "waiting_question",
  "waiting_plan",
  "error",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

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
 * 项目 `.ucode` → 项目 `.agents` → 全局 `$APP_HOME` → 用户 `~/.agents` → 内置。
 * 提示词命令只会有 `project` / `global` / `builtin` 三种。
 */
export const COMMAND_ASSET_SOURCES = [
  "project",
  "agents-project",
  "global",
  "agents-user",
  "builtin",
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
