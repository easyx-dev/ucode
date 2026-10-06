/**
 * 会话语义摘要（`SessionSummary`）的共享构造。
 *
 * 路由写点与 `session_created/updated` 事件下发都从这里取，避免「列表口径」与「事件口径」分叉。
 */
import type { SessionStatus, SessionSummary, ThinkingLevel } from "@ucode/contracts";
import { overrideOf, type SessionRepository } from "../db/session-repository";
import { workspaceDirOf } from "../harness/workspace";
import { draftSessionSummary, type SessionRuntimeState, sessionInfoToDTO } from "./serialize";
import { recordToInfo } from "./session-index";

/** 构造摘要所需的读取面：仓储 + 运行态 + 运行时默认值 */
export type SessionSummarySources = {
  repository: SessionRepository;
  /** 是否有活跃生成（池内 run 或流式会话） */
  isActive: (sessionId: string) => boolean;
  /** 细分状态（含挂起交互与计划待确认），口径见 `core/session-status` */
  statusOf: (sessionId: string) => SessionStatus;
  /** 运行时默认模型与档位 */
  defaults: () => { model: string | null; thinkingLevel: ThinkingLevel };
};

/** 会话不在仓储里（如已硬删）时返回 null，由调用方决定是否下发事件 */
export const describeSessionSummary = (
  sources: SessionSummarySources,
  sessionId: string,
): SessionSummary | null => {
  const record = sources.repository.find(sessionId);
  if (!record) return null;

  const { model, thinkingLevel } = sources.defaults();
  const override = overrideOf(record);
  const runtime: SessionRuntimeState = {
    running: sources.isActive(sessionId),
    status: sources.statusOf(sessionId),
  };

  if (!record.sourcePath) {
    return draftSessionSummary(
      sessionId,
      override,
      model,
      thinkingLevel,
      workspaceDirOf(sessionId),
      runtime,
      record.childCount,
      { createdAt: record.createdAt, updatedAt: record.updatedAt },
    );
  }

  return sessionInfoToDTO(
    recordToInfo(record),
    override,
    model,
    thinkingLevel,
    runtime,
    record.childCount,
  );
};
