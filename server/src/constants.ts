/** server 侧常量：默认值与固定目录名集中于此，避免散落在 env / logger 中 */

export const DEFAULT_PORT = 2048;

/** AgentSession 空闲多久后被回收 */
export const DEFAULT_POOL_IDLE_MS = 10 * 60 * 1000;

/** pi 私有数据目录名（位于 APP_HOME 下）：models / auth / sessions */
export const PI_DIRNAME = "pi";

/** 应用自有数据目录名（位于 APP_HOME 下）：config.json / SQLite */
export const APP_DIRNAME = "app";

/** 会话 JSONL 目录名（位于 pi 目录下） */
export const SESSIONS_DIRNAME = "sessions";

/** SQLite 数据库文件名（位于 app 目录下），与品牌无关，保持稳定 */
export const DB_FILENAME = "app.db";

/** 单个 /events 订阅者的待发队列上限；溢出即断开，由客户端重连补齐 */
export const SUBSCRIBER_QUEUE_MAX = 256;

/** /events 的心跳间隔（毫秒），防止中间代理掐掉空闲连接 */
export const EVENTS_HEARTBEAT_MS = 15_000;

export const CONFIG_FILENAME = "config.json";

/** pi 的模型注册文件 */
export const MODELS_FILENAME = "models.json";

/** pi 的鉴权文件 */
export const AUTH_FILENAME = "auth.json";

/** pino 支持的日志级别 */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
