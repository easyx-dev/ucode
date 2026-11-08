/**
 * 工作台（右侧第三栏）的状态注入：面板状态由预设持有，动作经这里下发给业务组件。
 *
 * 面板是 VSCode 那种「活动栏 + 侧栏 + 编辑器区」：活动栏切侧栏看什么（源代码管理 / 项目文件 / 终端，
 * 桌面端另有浏览器），
 * 侧栏可以整列收起，编辑器区按打开的文档出标签。对话区的引用与命令面板都要能打开某个文件，
 * 而它们与面板之间隔着多层组件，因此用 context 下发动作；状态本身仍由 `WorkspaceLayout` 持有。
 */

import type { GitCommitSummary, TerminalInfo } from "@ucode/contracts";
import { createContext, type ReactNode, useContext } from "react";

import type { WorkbenchDoc } from "../business/workbench/workbench-docs";

/**
 * 侧栏的视图。顺序即活动栏自上而下的排布：代码管理在最上（最常看），终端在文件之后。
 * `browser` 只在宿主注入了浏览器面时出现（见 `WorkbenchApi.browser`）；`design` 始终在列——
 * 入口藏起来等于让人先知道「有个设计模式」才能找到画布，而画布的空态本来就能说清怎么出稿。
 */
export const WORKBENCH_VIEWS = ["changes", "files", "terminal"] as const;

export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number] | "browser" | "design";

/**
 * 宿主提供的浏览器面（**仅桌面端**）：web 端没有内置浏览器，不传就没有这个视图、也开不出浏览器标签。
 *
 * 载体与驱动都在宿主里（桌面端是 Electron 的 `<webview>` + `webContents.debugger`），
 * 界面这一层只认「有几个标签、当前激活哪个」，以及合成的那一块画面。
 */
export type WorkbenchBrowserSurface = {
  /** 侧栏内容（标签列表与新建入口）；用 `useWorkbench()` 取标签与动作 */
  sidebar: ReactNode;
  /**
   * 编辑器区里渲染某个浏览器标签；`tabId` 由宿主对应到自己的 webview。
   *
   * `active` 是「用户正在看这一个」：未激活的标签也得留着（卸载即销毁页面），但宿主需要知道哪个是当前
   * 在看的——服务端按它决定 agent 驱动哪一个（见 docs/browser.md）。
   */
  renderTab: (tabId: string, options: { /** 用户正在看这一个 */ active: boolean }) => ReactNode;
};

/** 打开某个工作区变更时要看的对比对象 */
export type ChangeTarget = { file: string; staged: boolean };

export type WorkbenchApi = {
  /** 当前会话 id；设计画布按它取稿（null 表示草稿态，还没有会话） */
  sessionId: string | null;
  /** 打开某个设计稿文件的画布标签（并切到设计视图、展开面板） */
  openDesign: (path: string) => void;
  /** 侧栏当前视图 */
  view: WorkbenchView;
  selectView: (view: WorkbenchView) => void;
  /** 侧栏是否展开（收起后编辑器区占满） */
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  /**
   * 直接设为某个可见性。
   * 窄屏的「打开文档即切到编辑器 / 返回箭头切回侧栏」需要一个目标态，`toggleSidebar` 表达不了。
   */
  setSidebarVisible: (visible: boolean) => void;
  /** 编辑器区打开的文档与激活项 */
  docs: readonly WorkbenchDoc[];
  activeDocId: string | null;
  selectDoc: (id: string) => void;
  closeDoc: (id: string) => void;
  /** 只留这一个标签（标签右键菜单） */
  closeOtherDocs: (id: string) => void;
  closeAllDocs: () => void;
  /** 打开文件预览（面板未展开时一并展开） */
  openFile: (path: string) => void;
  /** 打开某个工作区变更的 diff */
  openChange: (target: ChangeTarget) => void;
  /** 打开某次提交的详情 */
  openCommit: (commit: GitCommitSummary) => void;
  /** 打开「全部改动」：所有变更文件的 diff 堆叠成一份文档 */
  openChanges: () => void;
  /** 收起整个面板 */
  collapse: () => void;
  /** 相对路径的解析基准：当前会话工作目录；null 表示没有工作目录 */
  cwd: string | null;
  /** 当前工作目录下的终端（服务端为唯一事实源，这里只是它的一份拉取结果） */
  terminals: readonly TerminalInfo[];
  /** 起一个终端并打开它的标签；失败写进 `terminalError` */
  createTerminal: () => void;
  /** 把已有终端重新挂上标签（列表里点开、或换目录后重新打开） */
  openTerminal: (terminalId: string) => void;
  /** 结束终端（杀进程）并从标签里摘掉 */
  closeTerminal: (terminalId: string) => void;
  /** 重新拉一份终端列表 */
  reloadTerminals: () => void;
  /** 最近一次「新建终端」的失败文案；没有失败时为 null */
  terminalError: string | null;
  /** 宿主注入的浏览器面；null 表示这一端没有内置浏览器（web 端） */
  browser: WorkbenchBrowserSurface | null;
  /** 新开一个浏览器标签并切过去（`tabId` 由这里生成） */
  openBrowserTab: () => void;
};

const WorkbenchContext = createContext<WorkbenchApi | null>(null);

export function WorkbenchProvider({
  value,
  children,
}: {
  value: WorkbenchApi;
  children: ReactNode;
}) {
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

/**
 * 取工作台动作；没有 Provider 时返回 null。
 * 消息区组件可能被单独复用（子会话嵌套视图、测试），调用方按 `?.` 处理即可，不强制要求上下文。
 */
export const useWorkbench = (): WorkbenchApi | null => useContext(WorkbenchContext);
