/**
 * 工作台显隐的记忆：按项目分键（含键的推导，便于单测）。
 *
 * 项目 id 由 `lib/project.ts` 的 `projectOf` 从当前工作目录解出。助理工作区会话的 cwd 是
 * `<workspace>/<sessionId>`，既不是项目也不在项目表里，于是回落全局键——若按 cwd 直接存，
 * 每个助理会话都会留下一条记忆。侧栏收起仍是全局的：那是「窗口该有多宽」的偏好，与项目无关。
 */
import { brand } from "@ucode/brand/values";

import { readStorage, writeStorage } from "./storage";

/** 全局键：没有项目上下文（草稿态、助理工作区）时用它 */
export const workbenchGlobalKey = (): string => `${brand.slug}-workbench-open`;

/** 某个项目的工作台显隐键；`projectId` 为空即全局键 */
export const workbenchOpenKeyOf = (projectId: string | null): string =>
  projectId ? `${workbenchGlobalKey()}:${projectId}` : workbenchGlobalKey();

/** 读出该项目的记忆；读不到（首次、隐私模式）按收起处理 */
export const readWorkbenchOpen = (projectId: string | null): boolean =>
  readStorage(workbenchOpenKeyOf(projectId)) === "1";

export const writeWorkbenchOpen = (projectId: string | null, open: boolean): void => {
  writeStorage(workbenchOpenKeyOf(projectId), open ? "1" : "0");
};
