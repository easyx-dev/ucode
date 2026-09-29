/** 会话接口的响应模型 */
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
};

export type SessionListResponse = {
  sessions: SessionSummary[];
  /** 过滤后的总数（受 q 影响、未按 limit 截断），用于「显示 n / 共 m」 */
  total: number;
};

export type SessionInfoResponse = {
  session: SessionSummary;
  /** 是否已有落盘文件（没有 assistant 回复时为 false） */
  persisted: boolean;
  entries: number;
};

export type SessionDeleteResponse = {
  deleted: boolean;
  sessionId: string;
};
