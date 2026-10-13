/**
 * 工作台的动作面：显隐（按项目记忆）、侧栏视图与可见性、编辑器文档标签，以及四个「打开」入口。
 * 面板状态在这里受控，业务组件只经 `WorkbenchApi` 拿动作。
 */
import type { GitCommitSummary } from "@ucode/contracts";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useWorkbenchDocs } from "../../business/workbench/use-workbench-docs";
import { changeDoc, changesDoc, commitDoc, fileDoc } from "../../business/workbench/workbench-docs";
import { readWorkbenchOpen, writeWorkbenchOpen } from "../../business/workbench/workbench-prefs";
import type { ChangeTarget, WorkbenchApi, WorkbenchView } from "../../provider/workbench";
import {
  fitPanelDefault,
  type PanelSpec,
  SIDEBAR_PANEL,
  WORKBENCH_PANEL,
  workbenchAvailableWidth,
} from "../../utils/panel-layout";

export type WorkbenchController = {
  /** 宽屏下面板是否展开 */
  open: boolean;
  /** 展开时的默认宽度规格：按窗口夹取，避免窄窗口把对话区压破 */
  panelSpec: PanelSpec;
  toggle: () => void;
  openFile: (path: string) => void;
  api: WorkbenchApi;
};

export function useWorkbenchController({
  cwd,
  projectId,
  isDesktop,
  setSheetOpen,
}: {
  /** 相对路径的解析基准：当前会话工作目录（草稿态取草稿里选的目录） */
  cwd: string | null;
  /** 显隐记忆按项目走；null 表示没有项目（助理工作区 / 草稿态），回落全局键 */
  projectId: string | null;
  isDesktop: boolean;
  /** 窄屏下的抽屉开关：打开工作台时一并唤出 */
  setSheetOpen: Dispatch<SetStateAction<boolean>>;
}): WorkbenchController {
  // 工作台：展开状态刷新后仍保持（宽度另有 usePanelLayout 管）；标签、树列可见性与预览目标一并受控
  const [open, setOpen] = useState(() => readWorkbenchOpen(projectId));
  // 侧栏视图与是否展开：都不落盘——面板收起后再打开回到默认视图（代码管理，最常看）
  const [view, setView] = useState<WorkbenchView>("changes");
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const docs = useWorkbenchDocs(cwd);

  /** 展开工作台时的默认宽度按窗口夹取：窄窗口下 640 会把对话区压破（记忆值优先） */
  const panelSpec = useMemo<PanelSpec>(
    () => ({
      ...WORKBENCH_PANEL,
      default: fitPanelDefault(
        WORKBENCH_PANEL,
        workbenchAvailableWidth(window.innerWidth, SIDEBAR_PANEL.default),
      ),
    }),
    [],
  );

  /** 展开 / 收起工作台并落盘（按当前项目）；移动端抽屉由 `setSheetOpen` 单独管 */
  const applyOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      writeWorkbenchOpen(projectId, next);
    },
    [projectId],
  );

  // 换项目就换一份记忆：初始化只跑一次，不重读会把上一个项目的显隐带过去
  useEffect(() => {
    setOpen(readWorkbenchOpen(projectId));
  }, [projectId]);

  /** 展开工作台；窄屏下同时唤出抽屉 */
  const show = useCallback(() => {
    applyOpen(true);
    if (!isDesktop) setSheetOpen(true);
  }, [applyOpen, isDesktop, setSheetOpen]);

  /** 打开某个文件的预览：面板未展开就展开（侧栏视图不动，标签自己表达打开了什么） */
  const openFile = useCallback(
    (path: string) => {
      docs.open(fileDoc(path));
      show();
    },
    [docs.open, show],
  );

  /** 打开某个工作区变更的 diff */
  const openChange = useCallback(
    ({ file, staged }: ChangeTarget) => {
      if (!cwd) return;
      docs.open(changeDoc(cwd, file, staged));
      show();
    },
    [cwd, docs.open, show],
  );

  /** 打开某次提交的详情 */
  const openCommit = useCallback(
    (commit: GitCommitSummary) => {
      if (!cwd) return;
      docs.open(commitDoc(cwd, commit));
      show();
    },
    [cwd, docs.open, show],
  );

  /** 打开「全部改动」：面板未展开就展开，所有变更文件的 diff 堆叠到同一份文档里 */
  const openChanges = useCallback(() => {
    if (!cwd) return;
    docs.open(changesDoc(cwd));
    show();
  }, [cwd, docs.open, show]);

  /**
   * 切换工作台。
   * 窄屏下工作台是抽屉，开关由 `setSheetOpen` 管，同一个按钮就应当开关它——
   * 「一律唤出」会让按钮在抽屉已开时显示「收起」却收不起来。
   */
  const toggle = useCallback(() => {
    if (!isDesktop) {
      setSheetOpen((prev) => !prev);
      // 抽屉用过一次就记住「工作台已启用」，桌面端切回来时依旧可见
      applyOpen(true);
      return;
    }
    if (open) applyOpen(false);
    else show();
  }, [applyOpen, isDesktop, open, setSheetOpen, show]);

  /** 活动栏：点当前视图即收起侧栏，点另一个视图即切换并展开 */
  const selectView = useCallback(
    (next: WorkbenchView) => {
      setSidebarVisible((visible) => (next === view ? !visible : true));
      setView(next);
    },
    [view],
  );

  const api = useMemo<WorkbenchApi>(
    () => ({
      view,
      selectView,
      sidebarVisible,
      toggleSidebar: () => setSidebarVisible((prev) => !prev),
      setSidebarVisible,
      docs: docs.docs,
      activeDocId: docs.activeDocId,
      selectDoc: docs.select,
      closeDoc: docs.close,
      closeOtherDocs: docs.closeOthers,
      closeAllDocs: docs.closeAll,
      openFile,
      openChange,
      openCommit,
      openChanges,
      /**
       * 收起整个面板。
       * 窄屏下工作台是抽屉，开关由 `setSheetOpen` 单独管——只改 `open` 是看不见效果的，
       * 活动栏的「收起面板」在移动端点了没反应就是这个原因。
       */
      collapse: () => {
        applyOpen(false);
        if (!isDesktop) setSheetOpen(false);
      },
      cwd,
    }),
    [
      applyOpen,
      cwd,
      docs.activeDocId,
      docs.close,
      docs.closeAll,
      docs.closeOthers,
      docs.docs,
      docs.select,
      isDesktop,
      openChange,
      openChanges,
      openCommit,
      openFile,
      selectView,
      setSheetOpen,
      sidebarVisible,
      view,
    ],
  );

  return { open, panelSpec, toggle, openFile, api };
}
