/**
 * 工作台（右侧第三栏）的状态注入：面板状态由预设持有，动作经这里下发给业务组件。
 *
 * 面板是「两个常驻标签 + 一条可开关的树列」：标签只有「改动」与「文件」，
 * 树列的内容随标签切换（改动 → 变更树，文件 → 项目树）。对话区的引用与命令面板
 * 都要能打开某个文件，而它们与面板之间隔着多层组件，因此用 context 下发动作；
 * 状态本身仍由 `WorkspaceLayout` 受控持有。
 */
import { createContext, type ReactNode, useContext } from "react";

/** 常驻的两个标签 */
export const WORKBENCH_TABS = ["changes", "files"] as const;

export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

export type WorkbenchApi = {
  tab: WorkbenchTab;
  selectTab: (tab: WorkbenchTab) => void;
  /** 树列是否展开（改动与文件共用） */
  treeVisible: boolean;
  toggleTree: () => void;
  /** 文件标签里正在预览的文件；null 表示还没选 */
  activeFile: string | null;
  /** 展开面板、切到「文件」标签并预览该文件 */
  openPreview: (path: string) => void;
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
