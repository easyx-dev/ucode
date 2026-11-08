/**
 * 工作台的动作面：显隐（按项目记忆）、侧栏视图与可见性、编辑器文档标签，以及四个「打开」入口。
 * 面板状态在这里受控，业务组件只经 `WorkbenchApi` 拿动作。
 */
import type { GitCommitSummary } from "@ucode/contracts";
import { asApiError } from "@ucode/sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { useTerminals } from "../../business/workbench/terminal/use-terminals";
import { useWorkbenchDocs } from "../../business/workbench/use-workbench-docs";
import {
  browserDoc,
  changeDoc,
  changesDoc,
  commitDoc,
  designDoc,
  fileDoc,
  terminalDoc,
  terminalDocId,
} from "../../business/workbench/workbench-docs";
import { readWorkbenchOpen, writeWorkbenchOpen } from "../../business/workbench/workbench-prefs";
import { useDesignPath } from "../../hooks/store/use-design";
import { useClient } from "../../provider";
import type {
  ChangeTarget,
  WorkbenchApi,
  WorkbenchBrowserSurface,
  WorkbenchView,
} from "../../provider/workbench";
import { errorText } from "../../utils/error-text";
import {
  fitPanelDefault,
  type PanelSpec,
  SIDEBAR_PANEL,
  WORKBENCH_PANEL,
  workbenchAvailableWidth,
} from "../../utils/panel-layout";
import { previewKindOf } from "../../utils/preview";

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
  sessionId,
  projectId,
  isDesktop,
  setSheetOpen,
  browser = null,
}: {
  /** 相对路径的解析基准：当前会话工作目录（草稿态取草稿里选的目录） */
  cwd: string | null;
  /** 当前会话 id：设计画布按它取稿 */
  sessionId: string | null;
  /** 显隐记忆按项目走；null 表示没有项目（助理工作区 / 草稿态），回落全局键 */
  projectId: string | null;
  isDesktop: boolean;
  /** 窄屏下的抽屉开关：打开工作台时一并唤出 */
  setSheetOpen: Dispatch<SetStateAction<boolean>>;
  /** 宿主注入的浏览器面（仅桌面端）；不传即没有这个视图 */
  browser?: WorkbenchBrowserSurface | null;
}): WorkbenchController {
  // 工作台：展开状态刷新后仍保持（宽度另有 usePanelLayout 管）；标签、树列可见性与预览目标一并受控
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => readWorkbenchOpen(projectId));
  // 侧栏视图与是否展开：都不落盘——面板收起后再打开回到默认视图（代码管理，最常看）
  const [view, setView] = useState<WorkbenchView>("changes");
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const docs = useWorkbenchDocs(cwd, sessionId);
  const client = useClient();
  /** 本会话当前在改哪份稿：只订阅已加载的画布状态，不在控制器里触发加载 */
  const designPath = useDesignPath(sessionId);
  const terminals = useTerminals(cwd);
  const [terminalError, setTerminalError] = useState<string | null>(null);

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

  /**
   * 打开设计画布：**先把本会话的当前稿指过去，再打开标签**。
   *
   * 标签只是视图——它不携带稿子身份、切会话即清掉；「本会话在改哪份」是会话上的指针，
   * 显式打开（这里 / 文件树点 `.design` / agent `design_open`）改写它，画布首次取值只会在
   * 还没有指针时确立一个默认落点——所以不会把别的会话开着的那份带过来。
   */
  const openDesign = useCallback(
    (path: string) => {
      // 已经指向这一份就不必再开一次（服务端会重新读盘探测并广播一次更新）
      if (sessionId !== null && designPath !== path) void client.design.openFile(sessionId, path);
      docs.open(designDoc(sessionId));
      setView("design");
      setSidebarVisible(true);
      show();
    },
    [client, designPath, docs.open, sessionId, show],
  );

  /** 打开某个文件的预览：面板未展开就展开（侧栏视图不动，标签自己表达打开了什么） */
  const openFile = useCallback(
    (path: string) => {
      // 设计稿没有文本预览：点开它就是「在本会话里打开这份稿」，直接进画布
      if (previewKindOf(path) === "design") {
        openDesign(path);
        return;
      }
      docs.open(fileDoc(path));
      show();
    },
    [docs.open, openDesign, show],
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

  const { open: openDoc, close: closeDocOf, closeOthers, closeAll } = docs;

  /** 浏览器标签的编号：宿主只当它是不透明标识；换目录清标签后不回退，避免重复编号 */
  const browserTabSeq = useRef(0);

  /** 新开一个浏览器标签：编号在这里生成，宿主按编号对应自己的 webview */
  const openBrowserTab = useCallback(() => {
    browserTabSeq.current += 1;
    openDoc(browserDoc(`t${browserTabSeq.current}`));
    show();
  }, [openDoc, show]);

  const { create: createTerminalOf, close: closeTerminalOf, reload: reloadTerminals } = terminals;

  /** 把已有终端重新挂上标签时用的动作（列表里点开、或换目录后重新打开） */
  const openTerminal = useCallback(
    (terminalId: string) => {
      openDoc(terminalDoc(terminalId));
      show();
    },
    [openDoc, show],
  );

  /** 起一个终端：成功即挂标签，失败把文案贴在侧栏（错误就发生在点击处，不另弹一层遮罩） */
  const createTerminal = useCallback(() => {
    if (!cwd) return;
    setTerminalError(null);
    createTerminalOf(cwd)
      .then((info) => {
        openDoc(terminalDoc(info.id));
        show();
      })
      .catch((error: unknown) => {
        setTerminalError(errorText(t, asApiError(error)));
      });
  }, [cwd, createTerminalOf, openDoc, show, t]);

  /**
   * 关标签即结束终端：终端标签与进程一一对应，留着进程却看不到它才是真麻烦。
   * 右键的「关闭其他 / 关闭全部」同样要带上这一步，否则会留下一批看不见的进程。
   */
  const closeTerminal = useCallback(
    (terminalId: string) => {
      void closeTerminalOf(terminalId);
      closeDocOf(terminalDocId(terminalId));
    },
    [closeDocOf, closeTerminalOf],
  );

  /**
   * 关标签：终端标签连着进程，得一并结束；浏览器画面标签只停止观看（实例归 agent 管），
   * 直接关掉即可——但它会让「谁还在用某个 profile」变化，所以顺手刷一次列表。
   */
  const closeDoc = useCallback(
    (id: string) => {
      const doc = docs.docs.find((item) => item.id === id);
      if (doc?.kind === "terminal") {
        void closeTerminalOf(doc.terminalId);
      }
      closeDocOf(id);
    },
    [closeDocOf, closeTerminalOf, docs.docs],
  );

  const closeOtherDocs = useCallback(
    (id: string) => {
      for (const doc of docs.docs) {
        if (doc.id !== id && doc.kind === "terminal") void closeTerminalOf(doc.terminalId);
      }
      closeOthers(id);
    },
    [closeOthers, closeTerminalOf, docs.docs],
  );

  const closeAllDocs = useCallback(() => {
    for (const doc of docs.docs) {
      if (doc.kind === "terminal") void closeTerminalOf(doc.terminalId);
    }
    closeAll();
  }, [closeAll, closeTerminalOf, docs.docs]);

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

  /**
   * 活动栏：点当前视图即收起侧栏，点另一个视图即切换并展开。
   *
   * 设计视图顺带确保画布标签在（不像终端那样「视图只列清单、标签自己开」）：设计视图的侧栏是图层树，
   * 离开画布就只是一棵点不动的树。
   */
  const selectView = useCallback(
    (next: WorkbenchView) => {
      setSidebarVisible((visible) => (next === view ? !visible : true));
      setView(next);
    },
    [openDoc, view],
  );

  const api = useMemo<WorkbenchApi>(
    () => ({
      sessionId,
      openDesign,
      designPath,
      view,
      selectView,
      sidebarVisible,
      toggleSidebar: () => setSidebarVisible((prev) => !prev),
      setSidebarVisible,
      docs: docs.docs,
      activeDocId: docs.activeDocId,
      selectDoc: docs.select,
      closeDoc,
      closeOtherDocs,
      closeAllDocs,
      openFile,
      openChange,
      openCommit,
      openChanges,
      terminals: terminals.items,
      createTerminal,
      openTerminal,
      closeTerminal,
      reloadTerminals,
      terminalError,
      browser,
      openBrowserTab,
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
      browser,
      closeAllDocs,
      designPath,
      openDesign,
      sessionId,
      closeDoc,
      closeOtherDocs,
      createTerminal,
      cwd,
      docs.activeDocId,
      docs.docs,
      docs.select,
      isDesktop,
      openBrowserTab,
      openChange,
      openChanges,
      openCommit,
      openFile,
      openTerminal,
      closeTerminal,
      reloadTerminals,
      selectView,
      setSheetOpen,
      sidebarVisible,
      terminalError,
      terminals.items,
      view,
    ],
  );

  return { open, panelSpec, toggle, openFile, api };
}
