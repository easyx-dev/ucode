/** 会话侧栏：装配头部、按区分的列表与设置入口 */
import { Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DirectoryPickerDialog } from "@/components/directory-picker-dialog";
import { RenameSessionDialog } from "@/components/rename-session-dialog";
import { SessionList } from "@/components/session-list";
import { SessionSidebarHeader } from "@/components/session-sidebar-header";
import { Button } from "@/components/ui/button";
import { useSessionFilter } from "@/hooks/use-session-filter";
import { confirmArchiveSession, sessionTitle } from "@/lib/session";
import type { SessionSummary } from "@/lib/types";

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
  onRename: (sessionId: string, name: string) => void;
  onDelete: (sessionId: string) => void;
  onOpenSettings: () => void;
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
  onRename,
  onDelete,
  onOpenSettings,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{ sessionId: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const filtered = useSessionFilter(sessions, query);

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
        onRename={(session) =>
          setRenaming({ sessionId: session.id, name: sessionTitle(session, t("新会话")) })
        }
        onDelete={(session) => {
          if (confirmArchiveSession(session, t)) onDelete(session.id);
        }}
      />

      <div className="border-t p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onOpenSettings}>
          <Settings2 className="size-4" />
          {t("设置")}
        </Button>
      </div>

      <RenameSessionDialog
        target={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onSubmit={onRename}
      />

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
