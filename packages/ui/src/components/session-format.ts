import type { SessionSummary } from "@ucode/sdk";

/**
 * 侧栏会话列表的**纯展示逻辑**。
 *
 * 抽出来的理由与其它 `*-format.ts` 一致：分组、相对时间、标题兜底都是产品约定，
 * 边界（空目录、非法时间、没有名称的会话）最容易出错，而它们与 React 无关。
 */

/** 项目名取路径最后一段（ZCode 侧栏按项目分组时显示的就是这个名字）。 */
export function projectLabel(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed === "") return "未指定目录";
  const segments = trimmed
    .replace(/[/\\]+$/u, "")
    .split(/[/\\]/u)
    .filter((segment) => segment !== "");
  // 根目录本身没有"最后一段"，但它显然不是"未指定目录"，原样返回。
  return segments.at(-1) ?? trimmed;
}

/**
 * 相对时间：刚刚 / 12分钟 / 4小时 / 3天 / 2周 / 具体日期。
 *
 * 超过五周就给日期：那时候"多少周前"已经不再帮助判断，反倒要人去算。
 */
export function formatRelativeTime(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天`;
  const weeks = Math.floor(days / 7);
  if (weeks <= 5) return `${weeks}周`;
  return new Date(time).toISOString().slice(0, 10);
}

export function sessionTitle(session: SessionSummary): string {
  const name = session.name?.trim() ?? "";
  if (name !== "") return name;
  const first = session.firstMessage?.trim() ?? "";
  if (first !== "") return first.length > 60 ? `${first.slice(0, 60)}…` : first;
  return session.id.slice(0, 10);
}

export function sessionSubtitle(session: SessionSummary): string {
  const first = session.firstMessage?.trim() ?? "";
  if (session.name === null || session.name === "") return projectLabel(session.cwd);
  return first === "" ? "（空会话）" : first;
}

export type ProjectGroup = {
  /** 分组键（工作目录）。 */
  key: string;
  label: string;
  sessions: SessionSummary[];
};

/** 按工作目录分组：组间按"最近的会话"倒序，组内按更新时间倒序。 */
export function groupSessionsByProject(sessions: readonly SessionSummary[]): ProjectGroup[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const list = groups.get(session.cwd) ?? [];
    list.push(session);
    groups.set(session.cwd, list);
  }
  const ordered = [...groups.entries()].map(([key, list]) => ({
    key,
    label: projectLabel(key),
    sessions: [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  }));
  return ordered.sort((a, b) => latestOf(b.sessions) - latestOf(a.sessions));
}

function latestOf(sessions: readonly SessionSummary[]): number {
  return sessions.reduce((max, session) => {
    const time = Date.parse(session.updatedAt);
    return Number.isNaN(time) ? max : Math.max(max, time);
  }, 0);
}

/** 侧栏筛选：归档开关 + 关键词（名称与首条消息）。 */
export function filterSessions(
  sessions: readonly SessionSummary[],
  query: string,
  showArchived: boolean,
): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (!showArchived && session.archived) return false;
    if (needle === "") return true;
    const haystack = `${session.name ?? ""} ${session.firstMessage ?? ""} ${session.cwd}`;
    return haystack.toLowerCase().includes(needle);
  });
}

/** 会话行的状态点：运行中 / 等待应答 / 只读挂载 / 空闲。 */
export type SessionTone = "running" | "waiting" | "readonly" | "idle";

export function sessionTone(input: {
  isActive: boolean;
  running: boolean;
  waiting: boolean;
  readOnly: boolean;
}): SessionTone {
  if (input.readOnly && input.isActive) return "readonly";
  if (input.waiting) return "waiting";
  if (input.running) return "running";
  return "idle";
}
