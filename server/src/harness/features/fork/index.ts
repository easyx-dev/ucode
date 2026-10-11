/**
 * 会话分叉的文件层原语：给定源会话文件 + 分叉点，抽出「root → 该节点」这段路径写成新会话文件。
 *
 * 这是「用户侧会话分叉」与后续「编辑历史 / 子智能体 fork 上下文」共用的底座；
 * 复用 pi 的 `SessionManager.createBranchedSession`，不自己维护条目树。
 * 只负责文件与分叉点校验，落库与 DTO 组装由调用方（路由层）完成。
 */
import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES } from "@ucode/contracts";

import type { SessionRecord } from "../../../db/session-repository";
import { AppError } from "../../../platform/response";

export type ForkedSessionFile = {
  /** 新会话 id（pi 生成） */
  id: string;
  /** 新会话 JSONL 路径 */
  sourcePath: string;
  /** 已切到新会话的 pi manager，供调用方回写索引 */
  manager: SessionManager;
};

/**
 * 解析可分叉的源会话：不满足条件时抛可读的 `AppError`，否则返回记录（`sourcePath` 已确定为非空）。
 * `active` 由调用方按会话池的「是否在跑」传入；抽成纯函数便于单测。
 */
export type ForkableSource = Omit<SessionRecord, "sourcePath"> & { sourcePath: string };

export const resolveForkSource = (
  sessionId: string,
  record: SessionRecord | undefined,
  active: boolean,
): ForkableSource => {
  if (!record || record.deletedAt) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  // 子智能体会话只读且没有独立模式语义，不能作为分叉源
  if (record.parentSessionId || record.agent) {
    throw new AppError(ERROR_CODES.invalidRequest, "子智能体会话不支持分叉", 400);
  }
  if (active) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }
  if (!record.sourcePath) {
    throw new AppError(ERROR_CODES.invalidRequest, "会话还没有可保存的内容，无法分叉", 400);
  }
  return { ...record, sourcePath: record.sourcePath };
};

/**
 * 抽出分叉会话文件。任何一步失败都抛可读的 `AppError`（400），不留半成品。
 * 用**独立的 manager**（`SessionManager.open`）而不是池里的实时实例：
 * `createBranchedSession` 会把 manager 切到新文件，绝不能作用在正在跑的会话上。
 */
export const createForkedSessionFile = (input: {
  sourcePath: string;
  /** 源会话解析后的工作目录；新会话文件 header 与 DB 行都沿用它 */
  cwd: string;
  /** 源会话里的条目 id；缺省取当前叶子 */
  fromEntryId?: string;
}): ForkedSessionFile => {
  const manager = SessionManager.open(input.sourcePath, undefined, input.cwd);
  const fromEntryId = input.fromEntryId ?? manager.getLeafId();
  if (!fromEntryId) {
    throw new AppError(ERROR_CODES.invalidRequest, "源会话还没有可分叉的内容", 400);
  }
  if (!manager.getEntry(fromEntryId)) {
    throw new AppError(ERROR_CODES.invalidRequest, `分叉点不存在：${fromEntryId}`, 400);
  }
  // pi 只在分支里出现过用户消息时才真正写文件；分叉点之前还没有对话就拒绝，避免留一个空文件
  const branch = manager.getBranch(fromEntryId);
  const hasConversation = branch.some(
    (entry) => entry.type === "message" && entry.message.role === "user",
  );
  if (!hasConversation) {
    throw new AppError(ERROR_CODES.invalidRequest, "分叉点之前还没有对话内容", 400);
  }

  let sourcePath: string | undefined;
  try {
    sourcePath = manager.createBranchedSession(fromEntryId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AppError(ERROR_CODES.invalidRequest, `分叉失败：${reason}`, 400);
  }
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new AppError(ERROR_CODES.internal, "分叉会话文件未能写出", 500);
  }

  return { id: manager.getSessionId(), sourcePath, manager };
};
