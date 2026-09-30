/** 侧栏的会话列表区域：项目区（按目录分组）+ 助理区（平铺），含加载 / 空态 */
import { brand } from "@ucode/brand";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SessionListItem } from "@/components/session-list-item";
import { SessionProjectGroup } from "@/components/session-project-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupSessions } from "@/lib/session-groups";
import type { SessionSummary } from "@/lib/types";

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

/** 折叠状态的存储键：项目目录用完整路径，避免不同目录末段重名时互相串 */
const groupKey = (path: string | null): string => path ?? "";

type SessionListProps = {
  sessions: SessionSummary[];
  /** 助理根目录（health.workspace）；用于区分助理区 */
  workspaceRoot: string | null;
  activeId: string | null;
  loading: boolean;
  onSelect: (sessionId: string) => void;
  /** 在指定目录里新建会话（项目区组头的 +） */
  onCreate: (cwd: string) => void;
  onRename: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
};

export function SessionList({
  sessions,
  workspaceRoot,
  activeId,
  loading,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SessionListProps) {
  const { t } = useTranslation();
  const sections = useMemo(() => groupSessions(sessions, workspaceRoot), [sessions, workspaceRoot]);
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

  const empty = !loading && sessions.length === 0;

  return (
    <ScrollArea className="flex-1">
      <div className="px-2 pb-3">
        {loading && sessions.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t("加载中…")}</p>
        ) : null}

        {empty ? <p className="px-2 py-2 text-xs text-muted-foreground">{t("暂无会话")}</p> : null}

        {empty ? null : (
          <div className="space-y-2">
            {sections.map((section) => (
              <div key={section.kind}>
                <p className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
                  {section.kind === "projects" ? t("项目区") : t("助理区")}
                </p>

                {section.kind === "projects" ? (
                  <div className="space-y-1">
                    {section.groups.map((group) => {
                      const key = groupKey(group.path);
                      return (
                        <SessionProjectGroup
                          key={key}
                          name={group.name}
                          path={group.path}
                          sessions={group.sessions}
                          activeId={activeId}
                          collapsed={collapsed.has(key)}
                          onCollapsedChange={(next) => toggle(key, next)}
                          onSelect={onSelect}
                          onRename={onRename}
                          onDelete={onDelete}
                          onCreate={() => group.path && onCreate(group.path)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {section.groups[0]?.sessions.map((session) => (
                      <SessionListItem
                        key={session.id}
                        session={session}
                        active={session.id === activeId}
                        onSelect={() => onSelect(session.id)}
                        onRename={() => onRename(session)}
                        onDelete={() => onDelete(session)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
