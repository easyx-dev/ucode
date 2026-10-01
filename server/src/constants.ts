/** server 侧常量：默认值与固定目录名集中于此，避免散落在 env / logger 中 */
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { brand } from "@ucode/brand/values";

export const DEFAULT_PORT = 2048;

/** AgentSession 空闲多久后被回收 */
export const DEFAULT_POOL_IDLE_MS = 10 * 60 * 1000;

/** agent 数据目录名（位于 APP_HOME 下）：auth.json / sessions */
export const AGENT_DIRNAME = "agent";

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

/** 权限审批等待用户答复的时限；超时按拒绝处理，避免工具调用永久挂起 */
export const PERMISSION_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/** pino 支持的日志级别 */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

/**
 * 系统提示词源：`custom` 用整段自研提示词，`pi` 用 pi 默认提示词并叠加自研片段。
 * 默认 `custom`——自研提示词是线上交付版本；`pi` 作为可对比的行为基线，供 `pnpm eval` 对照。
 */
export const PROMPT_SOURCES = ["pi", "custom"] as const;

export type PromptSource = (typeof PROMPT_SOURCES)[number];

/** 默认提示词源 */
export const DEFAULT_PROMPT_SOURCE: PromptSource = "custom";
