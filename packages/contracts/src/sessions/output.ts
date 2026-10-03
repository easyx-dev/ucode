/** 会话接口的响应模型 */
import type { ListResult, SessionScoped } from "../common";
import type { SessionMode, ThinkingLevel } from "../constants";

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
  /** 会话模式：决定工具集与权限 */
  mode: SessionMode;
  /** 父会话 id；子智能体会话非空（见 `plans/stage-7c-subagents.md`） */
  parentSessionId: string | null;
  /** 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 */
  agent: string | null;
  /** 是否有活跃生成（进程内的 run 或流式会话） */
  running: boolean;
  /** 归档时间；非空表示已归档（软删），列表默认过滤 */
  deletedAt: string | null;
};

export type SessionListResponse = ListResult & {
  sessions: SessionSummary[];
};

export type SessionInfoResponse = {
  session: SessionSummary;
};

export type SessionArchiveResponse = SessionScoped & {
  archived: boolean;
};
