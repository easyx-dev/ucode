/**
 * 工作台（右侧第三栏）的状态注入：面板状态由预设持有，动作经这里下发给业务组件。
 *
 * 面板是 VSCode 那种「活动栏 + 侧栏 + 编辑器区」：活动栏切侧栏看什么（项目文件 / 代码管理），
 * 侧栏可以整列收起，编辑器区按打开的文档出标签。对话区的引用与命令面板都要能打开某个文件，
 * 而它们与面板之间隔着多层组件，因此用 context 下发动作；状态本身仍由 `WorkspaceLayout` 持有。
 */

import type { GitCommitSummary } from "@ucode/contracts";
import { createContext, type ReactNode, useContext } from "react";

import type { WorkbenchDoc } from "../lib/workbench-docs";

/** 侧栏的两个视图（顺序即活动栏自上而下的排布：代码管理在前，它是最常看的） */
export const WORKBENCH_VIEWS = ["changes", "files"] as const;

export type WorkbenchView = (typeof WORKBENCH_VIEWS)[number];

/** 打开某个工作区变更时要看的对比对象 */
export type ChangeTarget = { file: string; staged: boolean };

export type WorkbenchApi = {
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
