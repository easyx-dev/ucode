/** 目标模式：自动续跑的断路器、无进展守卫，以及目标校验调用的回看范围与输出上限 */
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

/**
 * 目标校验调用的用量条目类型（`usage` 条目的 `kind`）。
 * 它不经过模型回合，得自己落一条才能进目标预算与全局统计。
 */
export const GOAL_VERIFY_USAGE_KIND = "goal_verify";
