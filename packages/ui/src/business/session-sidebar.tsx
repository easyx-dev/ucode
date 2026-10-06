/** 会话侧栏：品牌头、顶部功能菜单、项目 / 助理分类列表与底部设置入口 */
import { brand } from "@ucode/brand";
import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { confirmArchiveSession } from "../lib/session";
import type { SessionSummary } from "../lib/types";
import { BrandLogo } from "./brand-logo";
import { SessionList } from "./session-list";
import { SessionSidebarMenu } from "./session-sidebar-menu";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  /** 助理根目录（health.workspace）；用于区分助理区 */
  workspaceRoot: string | null;
  activeId: string | null;
  loading: boolean;
  configured: boolean;
  onSelect: (sessionId: string) => void;
  /** 新建任务（继承当前项目目录） */
  onCreate: () => void;
  /** 新建助理会话（落在助理工作区） */
  onCreateAssistant: () => void;
  /** 在指定目录里新建会话 */
  onCreateInDirectory: (path: string) => void;
  /** 请求重命名某个会话（对话框由 App 承载，便于 `/rename` 命令复用） */
  onRenameRequest: (session: SessionSummary) => void;
  onArchive: (sessionId: string) => void;
  /** 置顶 / 取消置顶 */
  onTogglePin: (session: SessionSummary) => void;
  onOpenSearch: () => void;
  onOpenWorkspace: () => void;
  onOpenAutomation: () => void;
  onOpenMarketplace: () => void;
  onOpenSettings: () => void;
  /** 已加载的子会话，按父会话 id 索引 */
  childrenByParent: Record<string, SessionSummary[]>;
  childrenLoading: Record<string, boolean>;
  /** 展开某个父会话时拉取其子会话 */
  onLoadChildren: (sessionId: string) => void;
  /** 当前会话若是子会话，这里是它的父会话 id；用于自动展开并高亮 */
  activeParentId: string | null;
};

export function SessionSidebar({
  sessions,
  workspaceRoot,
  activeId,
  loading,
  configured,
  onSelect,
  onCreate,
  onCreateAssistant,
  onCreateInDirectory,
  onRenameRequest,
  onArchive,
  onTogglePin,
  onOpenSearch,
  onOpenWorkspace,
  onOpenAutomation,
  onOpenMarketplace,
  onOpenSettings,
  childrenByParent,
  childrenLoading,
  onLoadChildren,
  activeParentId,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  /** 展开子会话的父会话 id；展开即拉取（重复展开会重取，保证楼层刷新后不过期） */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleChildren = useCallback(
    (sessionId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
          onLoadChildren(sessionId);
        }
        return next;
      });
    },
    [onLoadChildren],
  );

  // 直接打开 / 刷新子会话时自动展开其父会话，让当前项在侧栏可见
  useEffect(() => {
    if (!activeParentId) return;
    setExpanded((prev) => (prev.has(activeParentId) ? prev : new Set(prev).add(activeParentId)));
    onLoadChildren(activeParentId);
  }, [activeParentId, onLoadChildren]);

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <BrandLogo className="size-5" />
        <span className="text-sm font-semibold tracking-tight">{brand.name}</span>
      </div>

      <SessionSidebarMenu
        canCreate={configured}
        onCreate={onCreate}
        onCreateAssistant={onCreateAssistant}
        onOpenSearch={onOpenSearch}
        onOpenAutomation={onOpenAutomation}
        onOpenMarketplace={onOpenMarketplace}
      />

      <SessionList
        sessions={sessions}
        workspaceRoot={workspaceRoot}
        activeId={activeId}
        loading={loading}
        onSelect={onSelect}
        onCreate={onCreateInDirectory}
        onCreateAssistant={onCreateAssistant}
        onRename={onRenameRequest}
        onArchive={(session) => {
          if (confirmArchiveSession(session, t)) onArchive(session.id);
        }}
        onTogglePin={onTogglePin}
        onOpenWorkspace={onOpenWorkspace}
        childrenByParent={childrenByParent}
        childrenLoading={childrenLoading}
        expanded={expanded}
        onToggleChildren={toggleChildren}
        searching={false}
      />

      <div className="border-t border-sidebar-border p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          {t("设置")}
        </Button>
      </div>
    </aside>
  );
}
