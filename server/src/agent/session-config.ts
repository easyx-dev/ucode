/**
 * 会话装配层：把「会话覆盖值 + 运行时」收敛成 pi 的会话创建参数。
 *
 * 后续的模式（工具集 / 权限 / 自研提示词 / 工作区）都从这里汇入，
 * 是这些能力的唯一入口，避免各处在 `createAgentSession` 上各写一套。
 */
import {
  type CreateAgentSessionOptions,
  type SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { PiRuntime } from "../core/runtime";
import { overrideOf, type SessionRecord } from "../db/session-repository";
import { env } from "../env";

/** 会话工作目录：已落盘会话 > 覆盖值 > 调用方指定 > 全局工作目录 */
export const resolveSessionCwd = (
  record: SessionRecord | undefined,
  cwdOverride?: string,
): string => record?.piCwd || record?.cwd || cwdOverride || env.workspaceDir;

export type SessionAssemblyInput = {
  record: SessionRecord | undefined;
  /** 已由 `resolveSessionCwd` 解析好的工作目录 */
  cwd: string;
  sessionManager: SessionManager;
  runtime: PiRuntime;
};

/** 组装 AgentSession 的创建参数；模型与档位按「会话覆盖 > 全局默认」解析 */
export const buildSessionOptions = ({
  record,
  cwd,
  sessionManager,
  runtime,
}: SessionAssemblyInput): CreateAgentSessionOptions => {
  const override = overrideOf(record);
  const model = runtime.resolveModelRef(override.model) ?? runtime.resolveModelRef(null);
  const thinkingLevel = override.thinkingLevel ?? runtime.getStatus().thinkingLevel;

  return {
    cwd,
    agentDir: env.piDir,
    modelRuntime: runtime.requireRuntime(),
    ...(model ? { model } : {}),
    thinkingLevel,
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
  };
};
