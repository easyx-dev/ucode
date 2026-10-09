/**
 * 会话语义摘要（`SessionSummary`）的共享构造。
 *
 * 路由写点与 `session_created/updated` 事件下发都从这里取，避免「列表口径」与「事件口径」分叉。
 */
import {
  DEFAULT_THINKING_PREFERENCE,
  type SessionStatus,
  type SessionSummary,
  type ThinkingLevel,
} from "@ucode/contracts";
import { overrideOf, type SessionRecord, type SessionRepository } from "../db/session-repository";
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
  /** 运行时默认模型 */
  defaultModel: () => string | null;
  /** 会话在内存时的实际生效档位（pi 已按模型能力夹过）；不在内存时返回 null */
  effectiveThinkingLevel: (sessionId: string) => ThinkingLevel | null;
  /**
   * 某会话所属模式的推荐档位（`auto` 的解析结果）。
   * 只在该会话不在内存、且偏好为 `auto` 时才会被调用，实现可按需加载角色注册表。
   */
  recommendedThinkingLevel: (record: SessionRecord) => ThinkingLevel;
};

/**
 * 摘要里的实际档位：活会话取 pi 的生效值（已按模型能力夹过），
 * 否则把偏好解开——`auto` 才向 recommender 要模式推荐值，避免摘要路径白白扫一遍角色目录。
 */
export const resolvedThinkingLevelOf = (
  sources: SessionSummarySources,
  record: SessionRecord,
): ThinkingLevel => {
  const preference = overrideOf(record).thinkingLevel ?? DEFAULT_THINKING_PREFERENCE;
  return (
    sources.effectiveThinkingLevel(record.id) ??
    (preference === "auto" ? sources.recommendedThinkingLevel(record) : preference)
  );
};

/** 会话不在仓储里（如已硬删）时返回 null，由调用方决定是否下发事件 */
export const describeSessionSummary = (
  sources: SessionSummarySources,
  sessionId: string,
): SessionSummary | null => {
  const record = sources.repository.find(sessionId);
  if (!record) return null;

  const model = sources.defaultModel();
  const override = overrideOf(record);
  const resolvedThinkingLevel = resolvedThinkingLevelOf(sources, record);
  const runtime: SessionRuntimeState = {
    running: sources.isActive(sessionId),
    status: sources.statusOf(sessionId),
  };

  if (!record.sourcePath) {
    return draftSessionSummary(
      sessionId,
      override,
      model,
      resolvedThinkingLevel,
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
    resolvedThinkingLevel,
    runtime,
    record.childCount,
  );
};
