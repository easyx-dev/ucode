/** 会话侧栏：品牌头、顶部功能菜单、项目 / 助理分类列表与底部身份区 */
import { brand } from "@ucode/brand";
import { cn } from "cn";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "../../base/brand-logo";
import { Button } from "../../base/button";
import type { ProjectSummary, SessionSummary } from "../../types";
import { LocalUserRow } from "./local-user-row";
import { confirmArchiveSession } from "./session";
import { SessionList } from "./session-list";
import { SessionSidebarMenu } from "./session-sidebar-menu";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  /** 是否显示顶部品牌区（logo + 品牌名）；桌面端外壳传 false */
  showBrand: boolean;
  /** 项目行；侧栏组名与重命名入口用 */
  projects: ProjectSummary[];
  /** 助理根目录（health.workspace）；用于区分助理区 */
  workspacesDir: string | null;
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
  /** 请求重命名某个项目（对话框由 App 承载） */
  onRenameProject: (path: string) => void;
  /** 切项目级记忆开关 */
  onToggleProjectMemory: (path: string) => void;
  /** 把项目级记忆开关清回「跟随全局默认」 */
  onResetProjectMemory: (path: string) => void;
  /** 项目拖拽后的新次序（从上到下）；写回服务端后各端一致 */
  onReorderProjects: (paths: string[]) => void;
  onArchive: (sessionId: string) => void;
  /** 置顶 / 取消置顶 */
  onTogglePin: (session: SessionSummary) => void;
  onOpenSearch: () => void;
  onOpenWorkspace: () => void;
  onOpenAutomation: () => void;
  onOpenMarketplace: () => void;
  onOpenSettings: () => void;
};

export function SessionSidebar({
  sessions,
  showBrand,
  projects,
  workspacesDir,
  activeId,
  loading,
  configured,
  onSelect,
  onCreate,
  onCreateAssistant,
  onCreateInDirectory,
  onRenameProject,
  onToggleProjectMemory,
  onResetProjectMemory,
  onReorderProjects,
  onArchive,
  onTogglePin,
  onOpenSearch,
  onOpenWorkspace,
  onOpenAutomation,
  onOpenMarketplace,
  onOpenSettings,
}: SessionSidebarProps) {
  const { t } = useTranslation();

  return (
    // 品牌区去掉时留一点上边距：顶部那条是拖拽区与自绘控件的地盘，不留就把菜单贴上去了
    <aside
      className={cn(
        "flex h-full w-full flex-col bg-glass text-foreground backdrop-blur-sm",
        !showBrand && "pt-2",
      )}
    >
      {showBrand ? (
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <BrandLogo className="size-icon-lg" />
          <span className="text-sm font-semibold tracking-tight">{brand.name}</span>
        </div>
      ) : null}

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
        projects={projects}
        workspacesDir={workspacesDir}
        activeId={activeId}
        loading={loading}
        onSelect={onSelect}
        onCreate={onCreateInDirectory}
        onCreateAssistant={onCreateAssistant}
        onRenameProject={onRenameProject}
        onToggleProjectMemory={onToggleProjectMemory}
        onResetProjectMemory={onResetProjectMemory}
        onReorderProjects={onReorderProjects}
        onArchive={(session) => {
          void confirmArchiveSession(session, t).then((confirmed) => {
            if (confirmed) onArchive(session.id);
          });
        }}
        onTogglePin={onTogglePin}
        onOpenWorkspace={onOpenWorkspace}
      />

      <LocalUserRow
        className="shadow-edge"
        action={
          <Button variant="ghost" size="icon-sm" title={t("设置")} onClick={onOpenSettings}>
            <Settings2 className="size-icon-base" />
          </Button>
        }
      />
    </aside>
  );
}
