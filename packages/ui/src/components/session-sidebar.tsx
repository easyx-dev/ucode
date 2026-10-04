/** 会话侧栏：装配头部、按区分的列表与设置入口 */
import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionFilter } from "../hooks/use-session-filter";
import { confirmArchiveSession } from "../lib/session";
import type { SessionSummary } from "../lib/types";
import { DirectoryPickerDialog } from "./directory-picker-dialog";
import { SessionList } from "./session-list";
import { SessionSidebarHeader } from "./session-sidebar-header";
import { Button } from "./ui/button";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  /** 助理根目录（health.workspace）；用于区分助理区 */
  workspaceRoot: string | null;
  activeId: string | null;
  loading: boolean;
  configured: boolean;
  onSelect: (sessionId: string) => void;
  /** 新建助理会话（落在自己的工作区） */
  onCreate: () => void;
  /** 在指定目录里新建会话 */
  onCreateInDirectory: (path: string) => void;
  /** 请求重命名某个会话（对话框由 App 承载，便于 `/rename` 命令复用） */
  onRenameRequest: (session: SessionSummary) => void;
  onDelete: (sessionId: string) => void;
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
  onCreateInDirectory,
  onRenameRequest,
  onDelete,
  onOpenSettings,
  childrenByParent,
  childrenLoading,
  onLoadChildren,
  activeParentId,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  /** 展开子会话的父会话 id；展开即拉取（重复展开会重取，保证楼层刷新后不过期） */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const filtered = useSessionFilter(sessions, query);

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
    <aside className="flex h-full w-72 shrink-0 flex-col">
      <SessionSidebarHeader
        query={query}
        canCreate={configured}
        onQueryChange={setQuery}
        onCreate={onCreate}
        onPickDirectory={() => setPicking(true)}
      />

      <SessionList
        sessions={filtered}
        workspaceRoot={workspaceRoot}
        activeId={activeId}
        loading={loading}
        onSelect={onSelect}
        onCreate={onCreateInDirectory}
        onRename={onRenameRequest}
        onDelete={(session) => {
          if (confirmArchiveSession(session, t)) onDelete(session.id);
        }}
        childrenByParent={childrenByParent}
        childrenLoading={childrenLoading}
        expanded={expanded}
        onToggleChildren={toggleChildren}
        searching={query.trim().length > 0}
      />

      <div className="border-t p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          {t("设置")}
        </Button>
      </div>

      <DirectoryPickerDialog
        open={picking}
        onOpenChange={setPicking}
        onSelect={(path) => {
          onCreateInDirectory(path);
          setPicking(false);
        }}
      />
    </aside>
  );
}
