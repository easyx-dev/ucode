/** 环境变量取值的白名单：日志级别与系统提示词源，由 `env.ts` 校验时用 */
/** pino 支持的日志级别 */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

/**
 * 系统提示词源：`custom` 用整段自研提示词，`pi` 用 pi 默认提示词并叠加自研片段。
 * 具体取值由 `APP_PROMPT_SOURCE` 声明（见 .env / .env.prod），这里只做白名单校验。
 */
export const PROMPT_SOURCES = ["pi", "custom"] as const;

export type PromptSource = (typeof PROMPT_SOURCES)[number];
