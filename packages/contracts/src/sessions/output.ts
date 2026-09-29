/** 会话接口的响应模型 */
import type { ListResult, SessionScoped } from "../common";
import type { ThinkingLevel } from "../constants";

export type SessionSummary = {
  id: string;
  name: string | null;
  /** 会话工作目录 */
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** 首条用户消息，用作列表预览 */
  preview: string;
  /** 生效的 "provider/model" */
  model: string | null;
  thinkingLevel: ThinkingLevel;
  /** 是否有活跃生成（进程内的 run 或流式会话） */
  running: boolean;
};

export type SessionListResponse = ListResult & {
  sessions: SessionSummary[];
};

export type SessionInfoResponse = {
  session: SessionSummary;
  /** 是否已有落盘文件（没有 assistant 回复时为 false） */
  persisted: boolean;
  entries: number;
};

export type SessionDeleteResponse = SessionScoped & {
  deleted: boolean;
};
