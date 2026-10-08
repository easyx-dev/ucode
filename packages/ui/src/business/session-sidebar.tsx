/** 会话侧栏：品牌头、顶部功能菜单、项目 / 助理分类列表与底部身份区 */
import { brand } from "@ucode/brand";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "../base/avatar";
import { Button } from "../base/button";
import { confirmArchiveSession } from "../lib/session";
import type { SessionSummary } from "../lib/types";
import { BrandLogo } from "./brand-logo";
import { SessionList } from "./session-list";
import { SessionSidebarMenu } from "./session-sidebar-menu";

type SessionSidebarProps = {
  sessions: SessionSummary[];
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
};

export function SessionSidebar({
  sessions,
  workspacesDir,
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
}: SessionSidebarProps) {
  const { t } = useTranslation();
  /** 用户名的来源（登录态 / 配置项）尚未确定，本轮先固定展示；接入时只改这一处 */
  const localUserName = t("本地用户");

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
        workspacesDir={workspacesDir}
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
      />

      <div className="flex items-center gap-2 p-2 shadow-edge">
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">{localUserName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{localUserName}</span>
        <Button variant="ghost" size="icon-sm" title={t("设置")} onClick={onOpenSettings}>
          <Settings2 className="size-4" />
        </Button>
      </div>
    </aside>
  );
}
