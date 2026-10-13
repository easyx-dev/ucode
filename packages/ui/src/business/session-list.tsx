/** 侧栏的会话列表区域：项目（按目录分组）/ 助理 两个可折叠分类，含加载 / 空态 */
import { brand } from "@ucode/brand";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { isSessionUnread } from "../lib/session";
import { groupSessions, type SessionGroup } from "../lib/session-groups";
import type { ProjectSummary, SessionSummary } from "../lib/types";
import { SessionListItem } from "./session-list-item";
import { SessionPagedRows } from "./session-paged-rows";
import { SessionProjectGroup } from "./session-project-group";
import { SessionSection } from "./session-section";

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

/** 顶层分类的折叠键；与项目组的键（完整路径）共用一份存储，用前缀避免撞名 */
const sectionKey = (kind: "projects" | "assistant"): string => `section:${kind}`;

/** 折叠状态的存储键：项目目录用完整路径，避免不同目录末段重名时互相串 */
const groupKey = (path: string | null): string => path ?? "";

type SessionListProps = {
  sessions: SessionSummary[];
  /** 项目行；提供组名（未命名时回落目录末段） */
  projects: ProjectSummary[];
  /** 助理根目录（health.workspace）；用于区分助理区 */
  workspacesDir: string | null;
  activeId: string | null;
  loading: boolean;
  onSelect: (sessionId: string) => void;
  /** 在指定目录里新建会话（项目区组头的 +） */
  onCreate: (cwd: string) => void;
  /** 新建助理会话（助理分类的 +） */
  onCreateAssistant: () => void;
  /** 打开目录选择器（项目分类的 +） */
  onOpenWorkspace: () => void;
  /** 重命名项目（项目区组头的铅笔） */
  onRenameProject: (path: string) => void;
  onRename: (session: SessionSummary) => void;
  onArchive: (session: SessionSummary) => void;
  onTogglePin: (session: SessionSummary) => void;
};

export function SessionList({
  sessions,
  projects,
  workspacesDir,
  activeId,
  loading,
  onSelect,
  onCreate,
  onCreateAssistant,
  onOpenWorkspace,
  onRenameProject,
  onRename,
  onArchive,
  onTogglePin,
}: SessionListProps) {
  const { t } = useTranslation();
  const sections = useMemo(
    () => groupSessions(sessions, workspacesDir, projects),
    [sessions, workspacesDir, projects],
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

  const renderItem = useCallback(
    (session: SessionSummary) => (
      <SessionListItem
        key={session.id}
        session={session}
        activeId={activeId}
        onSelect={onSelect}
        unread={session.id !== activeId && isSessionUnread(session)}
        onTogglePin={() => onTogglePin(session)}
        onRename={() => onRename(session)}
        onArchive={() => onArchive(session)}
      />
    ),
    [activeId, onArchive, onRename, onSelect, onTogglePin],
  );

  // 项目 / 助理始终各渲染一个分类（即使下面没有会话），顺序固定
  const ordered = useMemo(() => {
    const byKind = new Map(sections.map((section) => [section.kind, section]));
    const none: SessionGroup[] = [];
    return (["projects", "assistant"] as const).map(
      (kind) => byKind.get(kind) ?? { kind, groups: none },
    );
  }, [sections]);

  /** 分类内的空态 / 加载提示 */
  const placeholder = (text: string) => (
    <p className="px-2 py-1 text-xs text-foreground-subtle">{loading ? t("加载中…") : text}</p>
  );

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div className="px-2 pb-3">
        <div className="space-y-1.5">
          {ordered.map((section) => {
            const key = sectionKey(section.kind);
            const isProjects = section.kind === "projects";
            const assistantSessions = isProjects ? [] : (section.groups[0]?.sessions ?? []);
            return (
              <SessionSection
                key={section.kind}
                title={isProjects ? t("项目") : t("助理")}
                collapsed={collapsed.has(key)}
                onCollapsedChange={(next) => toggle(key, next)}
                actions={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    title={isProjects ? t("打开工作区") : t("新建会话")}
                    onClick={isProjects ? onOpenWorkspace : onCreateAssistant}
                  >
                    <Plus className="size-icon-base" />
                  </Button>
                }
              >
                {isProjects ? (
                  section.groups.length === 0 ? (
                    placeholder(t("暂无项目"))
                  ) : (
                    section.groups.map((group) => {
                      const gKey = groupKey(group.path);
                      return (
                        <SessionProjectGroup
                          key={gKey}
                          name={group.name}
                          path={group.path}
                          sessions={group.sessions}
                          activeId={activeId}
                          collapsed={collapsed.has(gKey)}
                          onCollapsedChange={(next) => toggle(gKey, next)}
                          onCreate={() => group.path && onCreate(group.path)}
                          onRename={() => group.path && onRenameProject(group.path)}
                          renderItem={renderItem}
                        />
                      );
                    })
                  )
                ) : (
                  <div className="space-y-0.5">
                    {assistantSessions.length === 0 ? (
                      placeholder(t("暂无会话"))
                    ) : (
                      <SessionPagedRows
                        sessions={assistantSessions}
                        activeId={activeId}
                        renderItem={renderItem}
                      />
                    )}
                  </div>
                )}
              </SessionSection>
            );
          })}
        </div>
      </div>
    </div>
  );
}
