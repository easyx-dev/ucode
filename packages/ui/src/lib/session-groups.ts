/** 会话按区分组：项目区按 cwd 归组（组名取项目名、未命名时取目录末段），助理区（助理根下的会话）平铺 */
import { isUnderPath } from "./path";
import { projectLabel, projectOf } from "./project";
import type { ProjectSummary, SessionSummary } from "./types";

export type SessionGroup = {
  /** 组名；助理区平铺时为空串 */
  name: string;
  /** 项目目录；助理区平铺时为 null */
  path: string | null;
  sessions: SessionSummary[];
};

export type SessionSection = {
  kind: "projects" | "assistant";
  groups: SessionGroup[];
};

/**
 * 路径是否落在助理根之下（未绑定目录的会话，cwd 是 `<root>/<sessionId>`）。
 * 助理与项目会话共用同一套机制，区别只在「目录是不是我们分配的」，
 * 所以这里只看目录，不看会话上有没有别的标记。
 *
 * 与 server 侧 `isWorkspaceCwd` 同一口径（分隔符无关，Windows 与 POSIX 写法都认），两边分组才不会分叉。
 */
export const isWorkspaceSession = (cwd: string, root: string): boolean => isUnderPath(cwd, root);

/** 组内最早的创建时间：没有项目行的目录之间的排序键（组内是 `updatedAt` 降序，不能拿首项当最早） */
const groupCreatedAt = (sessions: readonly SessionSummary[]): string =>
  sessions.reduce(
    (earliest, session) => (session.createdAt < earliest ? session.createdAt : earliest),
    sessions[0]?.createdAt ?? "",
  );

/**
 * 分区：cwd 落在助理根之下的进「助理区」（平铺），其余按 cwd 精确归组进「项目区」。
 * 组内保持入参顺序（列表已按 `updatedAt` 降序）；项目区各组按 `projects` 的次序排——
 * 那份次序就是用户在侧栏拖出来的（见 `projects/reorder`）。目录还没有对应项目行时（早于项目表的会话），
 * 按组内最早会话的创建时间降序接在后面，新目录在前。
 * 空分区不输出。
 */
export const groupSessions = (
  sessions: SessionSummary[],
  workspacesDir: string | null,
  /** 项目行：提供组名（未命名时回落目录末段）与各组次序；还没登记过的目录不必传 */
  projects: readonly ProjectSummary[] = [],
): SessionSection[] => {
  const assistant: SessionSummary[] = [];
  const byDir = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    if (workspacesDir && isWorkspaceSession(session.cwd, workspacesDir)) {
      assistant.push(session);
      continue;
    }
    const list = byDir.get(session.cwd) ?? [];
    list.push(session);
    byDir.set(session.cwd, list);
  }

  const sections: SessionSection[] = [];

  /** 项目行里的位次；没有对应行时排在所有已登记的项目之后 */
  const rankOf = (path: string): number => {
    const index = projects.findIndex((project) => project.path === path);
    return index < 0 ? projects.length : index;
  };

  const projectGroups = [...byDir.entries()]
    .map(([path, items]) => ({
      name: projectLabel(path, projectOf(projects, path)),
      path,
      sessions: items,
    }))
    .sort((a, b) => {
      const delta = rankOf(a.path) - rankOf(b.path);
      return delta !== 0
        ? delta
        : groupCreatedAt(b.sessions).localeCompare(groupCreatedAt(a.sessions));
    });
  if (projectGroups.length > 0) sections.push({ kind: "projects", groups: projectGroups });

  if (assistant.length > 0) {
    sections.push({ kind: "assistant", groups: [{ name: "", path: null, sessions: assistant }] });
  }

  return sections;
};
