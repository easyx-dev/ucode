/** 项目记忆：索引与事实文件的长度门槛，以及自动回顾回看的范围、输出与超时 */
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
