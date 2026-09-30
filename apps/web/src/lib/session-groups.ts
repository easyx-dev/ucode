/** 会话按项目分组的纯函数：分组、排序与「默认」兜底 */
import { baseName } from "@/lib/path";
import type { Project, SessionSummary } from "@/lib/types";

export type SessionGroup = {
  /** 对应的项目；默认分组为 null */
  project: Project | null;
  /** 展示名；默认分组为空串，由调用方套 t("默认") */
  name: string;
  /** 项目目录；默认分组为 null */
  path: string | null;
  sessions: SessionSummary[];
};

/** 项目展示名：显式命名优先，否则取目录名 */
export const projectDisplayName = (project: Project): string =>
  project.name ?? baseName(project.path);

/**
 * 按项目分组：会话 `cwd` 与 `project.path` 精确匹配，匹配不到的进「默认」分组。
 * 会话在组内保持入参顺序（列表已按 `updatedAt` 降序）。
 * 排序：有会话的项目按组内最近活动降序，空项目接在其后（保持入参的 createdAt DESC），
 * 「默认」分组始终置底。`includeEmpty` 为假时不输出空项目分组（搜索态用）。
 */
export const groupSessions = (
  sessions: SessionSummary[],
  projects: Project[],
  includeEmpty = true,
): SessionGroup[] => {
  const byPath = new Map(projects.map((project) => [project.path, project]));
  const buckets = new Map<string, SessionSummary[]>(projects.map((project) => [project.id, []]));
  const fallback: SessionSummary[] = [];

  for (const session of sessions) {
    const project = byPath.get(session.cwd);
    if (project) buckets.get(project.id)?.push(session);
    else fallback.push(session);
  }

  const all: SessionGroup[] = projects.map((project) => ({
    project,
    name: projectDisplayName(project),
    path: project.path,
    sessions: buckets.get(project.id) ?? [],
  }));

  const visible = includeEmpty ? all : all.filter((group) => group.sessions.length > 0);
  visible.sort((a, b) => {
    const left = a.sessions[0]?.updatedAt;
    const right = b.sessions[0]?.updatedAt;
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    return right.localeCompare(left);
  });

  return [...visible, { project: null, name: "", path: null, sessions: fallback }];
};
