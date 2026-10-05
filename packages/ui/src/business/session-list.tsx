/** 侧栏的会话列表区域：项目区（按目录分组）+ 助理区（平铺），含加载 / 空态 */
import { brand } from "@ucode/brand";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "../base/scroll-area";
import { groupSessions } from "../lib/session-groups";
import type { SessionSummary } from "../lib/types";
import { SessionListItem } from "./session-list-item";
import { SessionProjectGroup } from "./session-project-group";

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
  /** 已加载的子会话，按父会话 id 索引 */
  childrenByParent: Record<string, SessionSummary[]>;
  childrenLoading: Record<string, boolean>;
  /** 已展开子会话的父会话 id */
  expanded: Set<string>;
  onToggleChildren: (sessionId: string) => void;
  /** 搜索期间收起子会话，避免把未参与过滤的子项混进结果 */
  searching: boolean;
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
  childrenByParent,
  childrenLoading,
  expanded,
  onToggleChildren,
  searching,
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

  const renderItem = useCallback(
    (session: SessionSummary) => (
      <SessionListItem
        key={session.id}
        session={session}
        activeId={activeId}
        onSelect={onSelect}
        onRename={() => onRename(session)}
        onDelete={() => onDelete(session)}
        expandable={!searching && session.childCount > 0}
        expanded={expanded.has(session.id)}
        onToggleExpand={() => onToggleChildren(session.id)}
        childSessions={childrenByParent[session.id]}
        childLoading={childrenLoading[session.id] ?? false}
      />
    ),
    [
      activeId,
      childrenByParent,
      childrenLoading,
      expanded,
      onDelete,
      onRename,
      onSelect,
      onToggleChildren,
      searching,
    ],
  );

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
                          collapsed={collapsed.has(key)}
                          onCollapsedChange={(next) => toggle(key, next)}
                          onCreate={() => group.path && onCreate(group.path)}
                          renderItem={renderItem}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {section.groups[0]?.sessions.map((session) => renderItem(session))}
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
