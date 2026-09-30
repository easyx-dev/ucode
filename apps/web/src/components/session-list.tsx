/** 侧栏的会话列表区域：按项目分组渲染，含加载 / 空态与折叠记忆 */
import { brand } from "@ucode/brand";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SessionProjectGroup } from "@/components/session-project-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupSessions } from "@/lib/session-groups";
import type { Project, SessionSummary } from "@/lib/types";

const COLLAPSED_KEY = `${brand.slug}-collapsed-session-groups`;

/** 折叠状态存储在 localStorage；隐私模式等读不到时回落空集合 */
const readCollapsed = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};

/** 折叠状态的存储键：项目用 id，默认分组用固定串 */
const groupKey = (projectId: string | null): string => projectId ?? "default";

type SessionListProps = {
  sessions: SessionSummary[];
  projects: Project[];
  activeId: string | null;
  loading: boolean;
  /** 搜索态：隐藏空项目分组 */
  filtering: boolean;
  onSelect: (sessionId: string) => void;
  /** 新建会话；null 表示用默认工作目录 */
  onCreate: (cwd: string | null) => void;
  onRename: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
};

export function SessionList({
  sessions,
  projects,
  activeId,
  loading,
  filtering,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onRenameProject,
  onDeleteProject,
}: SessionListProps) {
  const { t } = useTranslation();
  const groups = useMemo(
    () => groupSessions(sessions, projects, !filtering),
    [sessions, projects, filtering],
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  const toggle = useCallback((key: string, next: boolean) => {
    setCollapsed((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(key);
      else updated.delete(key);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...updated]));
      } catch {
        // 写不进去（隐私模式）不影响使用
      }
      return updated;
    });
  }, []);

  const empty = !loading && sessions.length === 0 && (filtering || projects.length === 0);

  return (
    <ScrollArea className="flex-1">
      <div className="px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t("加载中…")}</p>
        ) : null}

        {empty ? <p className="px-2 py-2 text-xs text-muted-foreground">{t("暂无会话")}</p> : null}

        {empty ? null : (
          <div className="space-y-1">
            {groups.map((group) => {
              const project = group.project;
              const key = groupKey(project?.id ?? null);
              return (
                <SessionProjectGroup
                  key={key}
                  name={group.name || t("默认")}
                  path={group.path}
                  sessions={group.sessions}
                  activeId={activeId}
                  collapsed={collapsed.has(key)}
                  onCollapsedChange={(next) => toggle(key, next)}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDelete={onDelete}
                  onCreate={() => onCreate(group.path)}
                  onRenameProject={project ? () => onRenameProject(project) : undefined}
                  onDeleteProject={project ? () => onDeleteProject(project) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
