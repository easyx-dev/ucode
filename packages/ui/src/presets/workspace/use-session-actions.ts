/**
 * 会话动作与草稿：新建 / 在目录新建 / 小助理、置顶、分叉、重命名（会话与项目）、已读、
 * 目录选择、拉取原始记录，以及模型 / 思考档位 / 模式 / 权限档位的选择（空态落草稿、有会话写服务端）。
 */

import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  type ComposerDraft,
  composerKeyOf,
  NEW_SESSION_KEY,
} from "../../business/composer/document/composer-draft";
import { projectOf, projectSeedOf } from "../../business/composer/project/project";
import { openRenameProjectDialog } from "../../business/composer/project/rename-project-dialog";
import type { useComposerDrafts } from "../../business/composer/use-composer-drafts";
import { openDirectoryPickerDialog } from "../../business/dialog/directory-picker-dialog";
import { openRenameSessionDialog } from "../../business/session/rename-session-dialog";
import { isWorkspaceSession } from "../../business/session/session-groups";
import type { useProjects } from "../../hooks/store/use-projects";
import type { useSessions } from "../../hooks/store/use-sessions";
import type { useActiveSession } from "../../hooks/use-active-session";
import { useClient } from "../../provider";
import type { ChatItem, PermissionMode, SessionSummary, ThinkingPreference } from "../../types";
import { errorText } from "../../utils/error-text";

export type SessionActions = {
  startNewSession: () => void;
  startInDirectory: (path: string) => void;
  startAssistantSession: () => void;
  pickDirectory: () => void;
  togglePin: (session: SessionSummary) => void;
  forkFrom: (item: ChatItem) => void;
  forkCurrent: () => void;
  requestRename: (session: SessionSummary) => void;
  requestRenameProject: (path: string) => void;
  loadTranscript: () => Promise<string>;
  selectModel: (model: string) => void;
  selectThinkingLevel: (level: ThinkingPreference) => void;
  selectMode: (mode: string) => void;
  selectPermissionMode: (mode: PermissionMode) => void;
};

export function useSessionActions({
  activeId,
  session,
  workspacesDir,
  sessions,
  projects,
  composer,
  setActiveId,
}: {
  activeId: string | null;
  session: ReturnType<typeof useActiveSession>;
  workspacesDir: string | null;
  sessions: ReturnType<typeof useSessions>;
  projects: ReturnType<typeof useProjects>;
  composer: ReturnType<typeof useComposerDrafts>;
  setActiveId: (sessionId: string | null) => void;
}): SessionActions {
  const { t } = useTranslation();
  const client = useClient();

  /**
   * 草稿的初始设置按目录所属的项目填：项目记住的模型 / 档位 / 模式 / 权限档位直接带进去，
   * 没记住的目录把这四项清空，由服务端回落全局默认——`/new`、目录选择、小助理共用这一条路径。
   */
  const seedDraftFor = (cwd: string | undefined): Partial<ComposerDraft> => ({
    cwd,
    ...projectSeedOf(projectOf(projects.projects, cwd ?? null)),
  });

  /**
   * 新建会话 = 回到草稿态（输入框里没收尾的内容留着）。
   * 继承当前会话所在的项目目录：在某个项目里 `/new` 应继续待在该项目，而不是落回助理区。
   */
  const startNewSession = (): void => {
    const inWorkspace = Boolean(
      session && workspacesDir && isWorkspaceSession(session.cwd, workspacesDir),
    );
    const cwd = session && !inWorkspace ? session.cwd : undefined;
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, seedDraftFor(cwd));
  };

  /** 「在目录中新建」：回到草稿态并把它绑到选中的目录，首条消息时才真建会话 */
  const startInDirectory = (path: string): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, seedDraftFor(path));
  };

  /** 「小助理」：回到草稿态并清掉目录，会话落到助理工作区（不绑定项目） */
  const startAssistantSession = (): void => {
    setActiveId(null);
    composer.update(NEW_SESSION_KEY, seedDraftFor(undefined));
  };

  /** 选目录（⌘O / 侧栏 / 命令面板共用）：选中的目录成为草稿的工作目录 */
  const pickDirectory = (): void => {
    void openDirectoryPickerDialog().then((path) => {
      if (path) startInDirectory(path);
    });
  };

  /** 置顶 / 取消置顶：乐观更新由 SDK store 处理，失败在错误条里提示 */
  const togglePin = (item: SessionSummary): void => {
    void sessions.pin(item.id, !item.pinnedAt);
  };

  const forkFrom = (item: ChatItem): void => {
    if (!activeId) return;
    void sessions.fork(activeId, item.id).then((created) => {
      if (created) setActiveId(created.id);
    });
  };

  /** `/fork`：从当前会话最新一条分叉（省略 fromEntryId，服务端取活动分支头部） */
  const forkCurrent = (): void => {
    if (!activeId) return;
    void sessions.fork(activeId).then((created) => {
      if (created) setActiveId(created.id);
    });
  };

  /** 请求重命名：弹层自己管开关，拿到新名称再提交 */
  const requestRename = (item: SessionSummary): void => {
    void openRenameSessionDialog(item).then((name) => {
      if (name) void sessions.rename(item.id, name);
    });
  };

  /** 请求重命名项目：清空输入即回落目录名（弹层给 null），取消不提交 */
  const requestRenameProject = (path: string): void => {
    const project = projectOf(projects.projects, path);
    void openRenameProjectDialog({ path, name: project?.name ?? null }).then((name) => {
      if (name === undefined) return;
      void projects.rename({ path, name });
    });
  };

  /**
   * 取当前会话的原始记录（JSONL 文本）供复制。内容可能几 MB，所以只在点按钮时取。
   * 失败要说清原因（记录过大、文件读不到），否则「复制出来是空的」看不出是失败。
   */
  const loadTranscript = useCallback(async (): Promise<string> => {
    if (!activeId) return "";
    try {
      const result = await client.apis.sessions.transcript(activeId);
      return result.content;
    } catch (error) {
      toast.error(errorText(t, error));
      throw error;
    }
  }, [activeId, client, t]);

  // 打开会话即标记已读：内容新于上次已读、且不在生成中时才提交，避免自我循环
  useEffect(() => {
    if (!session || session.running) return;
    if (session.lastReadAt && session.updatedAt <= session.lastReadAt) return;
    void sessions.markRead(session.id);
  }, [session, sessions.markRead]);

  // 空态（还没有会话）时，选择器改的是草稿里的初始设置，建会话时一并生效；
  // 已有会话走 sessions/update，结果落到服务端
  const draftKey = composerKeyOf(activeId);
  const selectModel = (model: string): void => {
    if (activeId) void sessions.setModel(activeId, model);
    else composer.update(draftKey, { model });
  };
  const selectThinkingLevel = (level: ThinkingPreference): void => {
    if (activeId) void sessions.setThinkingLevel(activeId, level);
    else composer.update(draftKey, { thinkingLevel: level });
  };
  const selectMode = (mode: string): void => {
    if (activeId) void sessions.setMode(activeId, mode);
    else composer.update(draftKey, { mode });
  };
  /** 权限档位只作用于已有会话：空态的选择器可点，但选了不落草稿，新建会话恒为默认档 */
  const selectPermissionMode = (mode: PermissionMode): void => {
    if (activeId) void sessions.setPermissionMode(activeId, mode);
  };

  return {
    startNewSession,
    startInDirectory,
    startAssistantSession,
    pickDirectory,
    togglePin,
    forkFrom,
    forkCurrent,
    requestRename,
    requestRenameProject,
    loadTranscript,
    selectModel,
    selectThinkingLevel,
    selectMode,
    selectPermissionMode,
  };
}
