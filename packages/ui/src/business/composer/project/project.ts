/** 项目在界面侧的取值：按路径取用、展示名回落目录末段、新建会话的初始设置 */

import type { ProjectSummary } from "../../../types";
import { baseName } from "../../../utils/path";
import type { ComposerDraft } from "../document/composer-draft";

/** 按路径取项目行；还没登记过的目录（老会话的目录）返回 null */
export const projectOf = (
  projects: readonly ProjectSummary[],
  path: string | null | undefined,
): ProjectSummary | null => (path ? (projects.find((item) => item.path === path) ?? null) : null);

/** 展示名：项目名优先，未命名时用目录末段 */
export const projectLabel = (path: string, project?: ProjectSummary | null): string =>
  project?.name ?? baseName(path);

/**
 * 新建会话的初始设置：项目记住的那几项，缺的给 `undefined`。
 *
 * 缺的必须显式给 `undefined` 而不是省略：草稿按浅合并写入，漏掉的键会继承上一个目录的值——
 * 在 A 项目选过模型后切到 B 项目，就会把 A 的模型带过去。
 */
export const projectSeedOf = (project: ProjectSummary | null): Partial<ComposerDraft> => ({
  model: project?.model ?? undefined,
  thinkingLevel: project?.thinkingLevel ?? undefined,
  mode: project?.mode ?? undefined,
  permissionMode: project?.permissionMode ?? undefined,
});

/**
 * 建会话 / 换项目的草稿种子：目标目录 + 它记住的四项。
 *
 * 换项目也必须走它，不能只改 `cwd`：草稿是浅合并，漏掉的键会继承上一个目录的值。
 */
export const draftSeedOf = (
  projects: readonly ProjectSummary[],
  cwd: string | undefined,
): Partial<ComposerDraft> => ({
  cwd,
  ...projectSeedOf(projectOf(projects, cwd ?? null)),
});
