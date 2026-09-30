/** 会话侧栏：装配头部、按项目分组的列表、项目 / 会话对话框与设置入口 */
import { Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { DirectoryPickerDialog } from "@/components/directory-picker-dialog";
import { RenameProjectDialog } from "@/components/rename-project-dialog";
import { RenameSessionDialog } from "@/components/rename-session-dialog";
import { SessionList } from "@/components/session-list";
import { SessionSidebarHeader } from "@/components/session-sidebar-header";
import { Button } from "@/components/ui/button";
import { useSessionFilter } from "@/hooks/use-session-filter";
import { confirmDeleteSession, sessionTitle } from "@/lib/session";
import { projectDisplayName } from "@/lib/session-groups";
import type { Project, SessionSummary } from "@/lib/types";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  projects: Project[];
  activeId: string | null;
  loading: boolean;
  configured: boolean;
  onSelect: (sessionId: string) => void;
  /** 新建会话；null 表示用默认工作目录（全局新建按钮） */
  onCreate: (cwd: string | null) => void;
  onRename: (sessionId: string, name: string) => void;
  onDelete: (sessionId: string) => void;
  onAddProject: (path: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenSettings: () => void;
};

export function SessionSidebar({
  sessions,
  projects,
  activeId,
  loading,
  configured,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onOpenSettings,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{ sessionId: string; name: string } | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [renamingProject, setRenamingProject] = useState<{
    projectId: string;
    name: string;
  } | null>(null);
  const filtered = useSessionFilter(sessions, query);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col">
      <SessionSidebarHeader
        query={query}
        canCreate={configured}
        onQueryChange={setQuery}
        onCreate={() => onCreate(null)}
        onAddProject={() => setAddingProject(true)}
      />

      <SessionList
        sessions={filtered}
        projects={projects}
        activeId={activeId}
        loading={loading}
        filtering={query.trim().length > 0}
        onSelect={onSelect}
        onCreate={onCreate}
        onRename={(session) =>
          setRenaming({ sessionId: session.id, name: sessionTitle(session, t("新会话")) })
        }
        onDelete={(session) => {
          if (confirmDeleteSession(session, t)) onDelete(session.id);
        }}
        onRenameProject={(project) =>
          setRenamingProject({ projectId: project.id, name: projectDisplayName(project) })
        }
        onDeleteProject={(project) => {
          if (window.confirm(t("删除项目确认", { name: projectDisplayName(project) })))
            onDeleteProject(project.id);
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

      <RenameProjectDialog
        target={renamingProject}
        onOpenChange={(open) => {
          if (!open) setRenamingProject(null);
        }}
        onSubmit={onRenameProject}
      />

      <DirectoryPickerDialog
        open={addingProject}
        onOpenChange={setAddingProject}
        onSelect={(path) => {
          onAddProject(path);
          setAddingProject(false);
        }}
      />
    </aside>
  );
}
