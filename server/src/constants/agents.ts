/** 角色相关上限：自定义角色文件的读取门槛与子智能体的并发、时长、命名约束 */
/** 单个自定义角色文件的大小上限，超过即跳过，避免误放大文件撑爆装配 */
export const CUSTOM_AGENT_MAX_BYTES = 256 * 1024;

/** 自定义角色 slug（文件名）的长度上限 */
export const CUSTOM_AGENT_SLUG_MAX_LENGTH = 64;

/** 单个父会话同时运行的子智能体数量上限；超限排队等空位，不等就报错 */
export const SUBAGENT_MAX_CONCURRENCY = 4;

/** 并发已满时最多等待的排队数；再多就别排了，直接告诉模型缩任务 */
export const SUBAGENT_QUEUE_MAX = 2;

/**
 * 排队等空位的最长时间。**故意很短**：代价不对称——失败一次只是多一次模型往返（10–20s），
 * 而干等是在用户眼前停住（分钟级），所以排队只用来兜「马上就有空位」那一下；
 * 真正排不下的批次应该立刻报错，让模型缩批次或稍后再派。
 */
export const SUBAGENT_QUEUE_WAIT_MS = 60 * 1000;

/**
 * 子智能体「无进展」的时限：连续这么久没有新消息 / 工具结果就判为卡住并中止。
 * 用空闲看门狗而不是总时长上限，是因为实测子会话跑完一次自包含任务常需 80–100 步，
 * 一刀切的 10 分钟会把干到八九成的活砍掉（见 `harness/features/subagents/spawn`）。
 */
export const SUBAGENT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** 子智能体的总时长上限：与 shell 的总时长同档，超了再怎么有进展也中止 */
export const SUBAGENT_MAX_DURATION_MS = 30 * 60 * 1000;

/** 子智能体会话名的长度上限（取任务简称） */
export const SUBAGENT_DESCRIPTION_MAX_LENGTH = 60;
