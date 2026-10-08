/** 会话按区分组：项目区按 cwd 归组，助理区（助理根下的会话）平铺 */
import { baseName } from "./path";
import type { SessionSummary } from "./types";

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
 */
export const isWorkspaceSession = (cwd: string, root: string): boolean => {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return cwd.startsWith(prefix);
};

/** 组内最早的创建时间：项目分组的排序键（组内是 `updatedAt` 降序，不能拿首项当最早） */
const groupCreatedAt = (sessions: readonly SessionSummary[]): string =>
  sessions.reduce(
    (earliest, session) => (session.createdAt < earliest ? session.createdAt : earliest),
    sessions[0]?.createdAt ?? "",
  );

/**
 * 分区：cwd 落在助理根之下的进「助理区」（平铺），其余按 cwd 精确归组进「项目区」。
 * 组内保持入参顺序（列表已按 `updatedAt` 降序）；项目区各组按**组内最早会话的创建时间**降序——
 * 新项目排最前，之后在哪个项目里发消息都不会把分组顺序顶得来回跳。
 * 空分区不输出。
 */
export const groupSessions = (
  sessions: SessionSummary[],
  workspacesDir: string | null,
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

  const projectGroups = [...byDir.entries()]
    .map(([path, items]) => ({ name: baseName(path), path, sessions: items }))
    .sort((a, b) => groupCreatedAt(b.sessions).localeCompare(groupCreatedAt(a.sessions)));
  if (projectGroups.length > 0) sections.push({ kind: "projects", groups: projectGroups });

  if (assistant.length > 0) {
    sections.push({ kind: "assistant", groups: [{ name: "", path: null, sessions: assistant }] });
  }

  return sections;
};
