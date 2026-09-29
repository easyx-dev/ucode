/** server 侧常量：默认值与固定目录名集中于此，避免散落在 env / logger 中 */

/** agent 主目录（相对 repoRoot），APP_HOME 未设置时使用 */
export const DEFAULT_HOME = ".tmp/.ucode";

export const DEFAULT_PORT = 2048;

/** AgentSession 空闲多久后被回收 */
export const DEFAULT_POOL_IDLE_MS = 10 * 60 * 1000;

/** agent 目录名（位于 APP_HOME 下） */
export const AGENT_DIRNAME = "agent";

/** 会话 JSONL 目录名（位于 agent 目录下） */
export const SESSIONS_DIRNAME = "sessions";

/** 单个 /events 订阅者的待发队列上限；溢出即断开，由客户端重连补齐 */
export const SUBSCRIBER_QUEUE_MAX = 256;

/** /events 的心跳间隔（毫秒），防止中间代理掐掉空闲连接 */
export const EVENTS_HEARTBEAT_MS = 15_000;

export const CONFIG_FILENAME = "config.json";

export const SESSION_STATE_FILENAME = "session-state.json";

/** pi 的模型注册文件 */
export const MODELS_FILENAME = "models.json";

/** pi 的鉴权文件 */
export const AUTH_FILENAME = "auth.json";

/** pino 支持的日志级别 */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
