/** 会话标题：回看的范围、生成的输入与输出上限、超时 */
/** 会话标题生成时最多回看的用户轮数；超出即不再尝试（会话已经不是「一件事」） */
export const TITLE_MAX_USER_TURNS = 2;

/** 会话标题生成时交流文本的字符上限（单条） */
export const TITLE_INPUT_MAX_CHARS = 2_000;

/** 会话标题长度上限（按码点计） */
export const TITLE_MAX_LENGTH = 24;

/**
 * 会话标题调用的最长输出 token。
 *
 * 思考与正文共享这个上限（pi 的 simple 请求只能选最低档思考、关不掉），实测一次标题调用的
 * 思考约 300 token、正文不到 10 个字符：上限给到 48 时正文完全没机会输出，标题必然解析失败。
 * 留一倍余量取 1024——标题调用每个会话只发生一次，这点开销可以忽略。
 */
export const TITLE_MAX_TOKENS = 1024;

/** 会话标题调用的超时；超时只记日志，列表继续用派生的标题口径 */
export const TITLE_TIMEOUT_MS = 20_000;
