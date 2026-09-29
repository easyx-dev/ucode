/** 会话侧栏：装配头部、列表与设置入口 */
import { Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { RenameSessionDialog } from "@/components/rename-session-dialog";
import { SessionList } from "@/components/session-list";
import { SessionSidebarHeader } from "@/components/session-sidebar-header";
import { Button } from "@/components/ui/button";
import { useSessionFilter } from "@/hooks/use-session-filter";
import { confirmDeleteSession, sessionTitle } from "@/lib/session";
import type { SessionSummary } from "@/lib/types";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  activeId: string | null;
  loading: boolean;
  configured: boolean;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onRename: (sessionId: string, name: string) => void;
  onDelete: (sessionId: string) => void;
  onOpenSettings: () => void;
};

export function SessionSidebar({
  sessions,
  activeId,
  loading,
  configured,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onOpenSettings,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{ sessionId: string; name: string } | null>(null);
  const filtered = useSessionFilter(sessions, query);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col">
      <SessionSidebarHeader
        query={query}
        canCreate={configured}
        onQueryChange={setQuery}
        onCreate={onCreate}
      />

      <SessionList
        sessions={filtered}
        activeId={activeId}
        loading={loading}
        onSelect={onSelect}
        onRename={(session) =>
          setRenaming({ sessionId: session.id, name: sessionTitle(session, t("新会话")) })
        }
        onDelete={(session) => {
          if (confirmDeleteSession(session, t)) onDelete(session.id);
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
    </aside>
  );
}
