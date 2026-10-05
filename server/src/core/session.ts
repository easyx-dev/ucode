/**
 * 会话创建：只落 DB 行（工作区目录由 `core/pool` 在会话真正要跑时建，见其 `ensure`）。
 */
import { randomUUID } from "node:crypto";

import { ERROR_CODES, type PermissionMode, type ThinkingLevel } from "@ucode/contracts";

import type { Services } from "../app";
import { AppError } from "../lib/response";
import { resolveTargetPath } from "../utils/path";

export const assertModel = (services: Services, ref: string): void => {
  if (!services.runtime.resolveModelRef(ref)) {
    throw new AppError(ERROR_CODES.unknownModel, `模型不可用：${ref}`, 400, undefined, { ref });
  }
};

/** 新建会话的初始设置；`cwd` 省略时会话落在自己的工作区 */
export type SessionSeed = {
  cwd?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  /** primary agent slug；缺省即内置 `build` */
  mode?: string;
  /** 会话级权限档位；缺省即内置 `default`（最放行档需显式选择） */
  permissionMode?: PermissionMode;
};

export const createSession = (services: Services, seed: SessionSeed): string => {
  const sessionId = randomUUID();
  services.sessions.create(sessionId, {
    // 与 pi 的 resolvePath 同口径：绝对化并折叠 `.` / `..`，避免同一目录因写法不同被分成两组
    ...(seed.cwd ? { cwd: resolveTargetPath(seed.cwd) } : {}),
    ...(seed.model ? { model: seed.model } : {}),
    ...(seed.thinkingLevel ? { thinkingLevel: seed.thinkingLevel } : {}),
    ...(seed.mode ? { mode: seed.mode } : {}),
    ...(seed.permissionMode ? { permissionMode: seed.permissionMode } : {}),
  });
  return sessionId;
};
