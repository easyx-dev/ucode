/** 鉴权：登录会话的有效期与清理间隔、登录限流窗口、一次性配对码有效期 */
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
