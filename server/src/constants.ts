/** server 侧常量：固定目录名与白名单集中于此；可配置的默认值由环境变量声明（见 .env / .env.prod） */
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { brand } from "@ucode/brand/values";

/** 运行时数据目录名（位于 APP_HOME 下）：auth.json / sessions */
export const HARNESS_DIRNAME = "harness";

/** 应用自有数据目录名（位于 APP_HOME 下）：config.json / SQLite */
export const APP_DIRNAME = "app";

/** 会话 JSONL 目录名（位于 pi 目录下） */
export const SESSIONS_DIRNAME = "sessions";

/** 会话工作区根目录名（位于主目录下）：`workspace/<sessionId>` */
export const WORKSPACE_DIRNAME = "workspace";

/** SQLite 数据库文件名（位于 app 目录下），与品牌无关，保持稳定 */
export const DB_FILENAME = "app.db";

/** 单个 /events 订阅者的待发队列上限；溢出即断开，由客户端重连补齐 */
export const SUBSCRIBER_QUEUE_MAX = 256;

/** /events 的心跳间隔（毫秒），防止中间代理掐掉空闲连接 */
export const EVENTS_HEARTBEAT_MS = 15_000;

export const CONFIG_FILENAME = "config.json";

/** 服务注册文件（位于 app 目录下）：host / port / 凭证，由服务独占写、客户端只读 */
export const SERVICE_FILENAME = "service.json";

/** pi 的 MCP 服务器配置（用户级），位于 agent 目录下，由本服务读写 */
export const MCP_CONFIG_FILENAME = "mcp.json";

/** pi 的鉴权文件 */
export const AUTH_FILENAME = "auth.json";

/** webfetch 未指定 timeout 时的超时（30s） */
export const WEBFETCH_DEFAULT_TIMEOUT_MS = 30_000;

/** webfetch 的 timeout 上限（120s） */
export const WEBFETCH_MAX_TIMEOUT_MS = 120_000;

/** webfetch 单次响应体的字节上限，超出即截断 */
export const WEBFETCH_MAX_BYTES = 5 * 1024 * 1024;

/** webfetch 交给模型的正文字节上限：与 pi 内置工具同档，避免大页面直接撑爆上下文 */
export const WEBFETCH_MAX_OUTPUT_BYTES = DEFAULT_MAX_BYTES;

/** webfetch 跟随重定向的最大跳数，每一跳都重新做地址准入 */
export const WEBFETCH_MAX_REDIRECTS = 5;

/** webfetch 的 User-Agent：带上品牌标识，便于站点侧识别来源（品牌串从品牌包取） */
export const WEBFETCH_USER_AGENT = `${brand.slug}-webfetch/1.0`;

/** websearch 单次返回条数上限 */
export const WEBSEARCH_MAX_RESULTS = 10;

/** websearch 单次请求的超时 */
export const WEBSEARCH_TIMEOUT_MS = 20_000;

/** agent 侧 shell 命令的总时长上限（秒）；模型可用 `timeout` 参数放宽 */
export const SHELL_COMMAND_TIMEOUT_SECONDS = 30 * 60;

/** agent 侧 shell 命令连续无输出的时长上限；到达即判定为等待交互输入并中止 */
export const SHELL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** 单个父会话同时运行的子智能体数量上限；超限立即报错，不排队 */
export const SUBAGENT_MAX_CONCURRENCY = 4;

/** 单次子智能体调用的时限；超时中止子会话，避免它继续烧 token */
export const SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000;

/** 子智能体会话名的长度上限（取任务简称） */
export const SUBAGENT_DESCRIPTION_MAX_LENGTH = 60;

/** 自定义角色目录名：全局 `$APP_HOME/agents/*.md`、项目配置目录 `agents/*.md` */
export const AGENTS_DIRNAME = "agents";

/** 全局技能目录名（位于 APP_HOME 下）：`skills/<id>/SKILL.md` */
export const SKILLS_DIRNAME = "skills";

/** 全局命令（提示词模板）目录名（位于 APP_HOME 下）：`prompts/<name>.md` */
export const PROMPTS_DIRNAME = "prompts";

/** 项目级配置目录名（位于会话 cwd 及其祖先）：品牌 slug 加前导点，如 `.<slug>` */
export const PROJECT_CONFIG_DIRNAME = `.${brand.slug}`;

/** 兼容生态的技能目录名（项目祖先或用户主目录下）：`.agents` */
export const AGENTS_COMPAT_DIRNAME = ".agents";

/** 附件库目录名（位于 `$APP_HOME/app` 下），按内容 sha256 寻址 */
export const ATTACHMENTS_DIRNAME = "attachments";

/** 图片归一化的最长边（像素） */
export const IMAGE_MAX_DIMENSION = 2000;

/** 图片归一化后的编码字节上限 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 草稿临时附件的保留时长：只在草稿里引用过、从未随消息发送的附件超期清理 */
export const ATTACHMENT_TEMP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 临时附件的扫描间隔 */
export const ATTACHMENT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** `@` 单次引用的文件数上限（目录展开后一并计入） */
export const CONTEXT_MAX_FILES = 64;

/** `@` 单个文件的读取字节上限 */
export const CONTEXT_MAX_FILE_BYTES = 200 * 1024;

/** `@` 单次引用的总字节上限 */
export const CONTEXT_MAX_TOTAL_BYTES = 512 * 1024;

/** fs/search 单次扫描的条目上限（交给 pi find 的 limit）；超出即标注截断 */
export const FS_SEARCH_MAX_SCAN = 20_000;

/** fs/search 跳过的目录名 */
export const FS_SEARCH_SKIP_DIRS = ["node_modules", ".git", "dist", ".next", ".turbo", ".cache"];

/** 单个自定义角色文件的大小上限，超过即跳过，避免误放大文件撑爆装配 */
export const CUSTOM_AGENT_MAX_BYTES = 256 * 1024;

/** 自定义角色 slug（文件名）的长度上限 */
export const CUSTOM_AGENT_SLUG_MAX_LENGTH = 64;

/** 项目记忆根目录名（位于 `$APP_HOME/app` 下）：`memory/projects/<project>` */
export const MEMORY_DIRNAME = "memory";

/** 记忆项目目录名（位于记忆根目录下） */
export const MEMORY_PROJECTS_DIRNAME = "projects";

/** 记忆索引文件名：一行一条，指向同目录下的事实文件 */
export const MEMORY_INDEX_FILENAME = "MEMORY.md";

/** 单个记忆文件 slug 的长度上限（按码点计） */
export const MEMORY_SLUG_MAX_LENGTH = 60;

/** 索引里每条记忆的描述长度上限 */
export const MEMORY_DESCRIPTION_MAX_LENGTH = 120;

/** 注入上下文时索引正文的字符上限，超出即截断（记忆不该撑爆提示词） */
export const MEMORY_INDEX_MAX_CHARS = 8_000;

/** 自动回顾时最多回看的用户轮数 */
export const MEMORY_REVIEW_MAX_USER_TURNS = 3;

/** 自动回顾时交流文本的字符上限 */
export const MEMORY_REVIEW_MAX_CHARS = 12_000;

/** 自动回顾调用的最长输出 token */
export const MEMORY_REVIEW_MAX_TOKENS = 1_024;

/** 自动回顾调用的超时；超时只记日志，不影响会话 */
export const MEMORY_REVIEW_TIMEOUT_MS = 60_000;

/** 会话标题生成时最多回看的用户轮数；超出即不再尝试（会话已经不是「一件事」） */
export const TITLE_MAX_USER_TURNS = 2;

/** 会话标题生成时交流文本的字符上限（单条） */
export const TITLE_INPUT_MAX_CHARS = 2_000;

/** 会话标题长度上限（按码点计） */
export const TITLE_MAX_LENGTH = 24;

/** 会话标题调用的最长输出 token；标题很短，卡紧上限以免小模型长篇大论 */
export const TITLE_MAX_TOKENS = 48;

/** 会话标题调用的超时；超时只记日志，列表继续用派生的标题口径 */
export const TITLE_TIMEOUT_MS = 20_000;

/** 目标模式自动续跑的轮数上限（断路器，见 plans/stage-11-goal.md）；对齐 pi-goal 的 25 */
export const GOAL_MAX_TURNS = 25;

/** 目标模式连续无工具调用多少轮后暂停（无进展守卫）；对齐 Codex / Claude / pi-goal */
export const GOAL_NO_PROGRESS_TURNS = 3;

/** 目标校验调用的最长输出 token */
export const GOAL_VERIFY_MAX_TOKENS = 1_024;

/** 目标校验调用的超时；超时按「未达成」处理并计入止损 */
export const GOAL_VERIFY_TIMEOUT_MS = 60_000;

/** 目标校验时最多回看的用户轮数 */
export const GOAL_EVIDENCE_MAX_USER_TURNS = 3;

/** 目标校验时交流文本的字符上限 */
export const GOAL_EVIDENCE_MAX_CHARS = 12_000;

/** pino 支持的日志级别 */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

/**
 * 系统提示词源：`custom` 用整段自研提示词，`pi` 用 pi 默认提示词并叠加自研片段。
 * 具体取值由 `APP_PROMPT_SOURCE` 声明（见 .env / .env.prod），这里只做白名单校验。
 */
export const PROMPT_SOURCES = ["pi", "custom"] as const;

export type PromptSource = (typeof PROMPT_SOURCES)[number];

/** 登录会话过期清理 / 限流窗口回收的扫描间隔 */
export const AUTH_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** 登录会话有效期（30 天） */
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 登录限流：窗口内允许的失败 / 尝试次数上限 */
export const LOGIN_RATE_LIMIT_MAX = 10;

/** 登录限流窗口 */
export const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/** 一次性配对码有效期（5 分钟） */
export const PAIRING_TTL_MS = 5 * 60 * 1000;
