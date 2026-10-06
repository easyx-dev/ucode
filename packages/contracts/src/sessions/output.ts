/** 会话接口的响应模型 */
import type { ListResult, SessionScoped } from "../common";
import type { PermissionMode, ThinkingLevel } from "../constants";
import type { GoalView } from "../goals/output";
import type { ContextUsage, UsageTotals } from "../stats/output";

export type SessionSummary = {
  id: string;
  name: string | null;
  /**
   * 会话的工作目录：绑定目录的会话是那个目录，未绑定的是分配给它自己的工作区
   * （`<助理根>/<sessionId>`，见 `health.workspace`）。
   */
  cwd: string;
  createdAt: string;
  updatedAt: string;
  /** 首条用户消息，用作列表预览 */
  preview: string;
  /** 生效的 "provider/model" */
  model: string | null;
  thinkingLevel: ThinkingLevel;
  /** 会话模式（primary agent slug）：决定工具集与权限 */
  mode: string;
  /** 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` */
  permissionMode: PermissionMode;
  /** 父会话 id；子智能体会话非空（见 `plans/stage-7c-subagents.md`） */
  parentSessionId: string | null;
  /** 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 */
  agent: string | null;
  /** 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 */
  forkedFromId: string | null;
  /** 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 */
  childCount: number;
  /** 是否有活跃生成（进程内的 run 或流式会话） */
  running: boolean;
  /** 置顶时间；非空表示置顶，排序时置顶项排在组内最前 */
  pinnedAt: string | null;
  /** 上次打开（标记已读）时间；用于判定未读：`updatedAt` 晚于它即未读 */
  lastReadAt: string | null;
  /** 归档时间；非空表示已归档（软删），列表默认过滤 */
  deletedAt: string | null;
};

export type SessionListResponse = ListResult & {
  sessions: SessionSummary[];
};

export type SessionInfoResponse = {
  session: SessionSummary;
  /** 本会话累计 token 用量（见 stage-10）；未落盘 / 无用量时为零值 */
  usage: UsageTotals;
  /**
   * 本会话当前上下文占用；判断依据不足时为空——未落盘、模型窗口不可知、压缩后还没出新一轮回答。
   */
  contextUsage: ContextUsage | null;
  /** 当前会话目标（见 plans/stage-11-goal.md）；未设置或已清除时为空 */
  goal: GoalView | null;
};

export type SessionArchiveResponse = SessionScoped & {
  archived: boolean;
};
