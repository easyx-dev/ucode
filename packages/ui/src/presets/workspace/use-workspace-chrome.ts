/**
 * 工作区外壳的几何与开合状态：侧栏收起（落盘）、窄屏的两个抽屉、桌面断点，
 * 以及自绘窗口控件中线的实测与发布。
 */
import { brand } from "@ucode/brand";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";

import { useIsDesktop } from "../../hooks/use-is-desktop";
import { readStorage, writeStorage } from "../../utils/storage";

/** 侧栏收起状态的持久化键 */
const SIDEBAR_COLLAPSED_KEY = `${brand.slug}-sidebar-collapsed`;

/** 读出上次的侧栏收起状态；读不到时默认展开 */
const readSidebarCollapsed = (): boolean => readStorage(SIDEBAR_COLLAPSED_KEY) === "1";

export type WorkspaceChrome = {
  /** 桌面断点：宽屏侧栏与工作台常驻，窄屏走抽屉 */
  isDesktop: boolean;
  /** 窄屏的侧栏抽屉 */
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  /** 宽屏的侧栏收起态 */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** 窄屏的工作台抽屉 */
  workbenchSheetOpen: boolean;
  setWorkbenchSheetOpen: Dispatch<SetStateAction<boolean>>;
  /**
   * 对话区头部此时是否占据窗口左端：桌面端看侧栏是否收起，窄屏看抽屉（侧栏不常驻，头部始终在窗左）。
   * 自绘窗口控件的归属就按它分：占据左端时挂在头部，否则挂在侧栏顶部那条里。
   */
  headerOwnsLeftEdge: boolean;
};

export function useWorkspaceChrome({
  titleBarInset,
}: {
  /** 无标题栏窗口为自绘控件让出的高度；0 表示没有自绘控件 */
  titleBarInset: number;
}): WorkspaceChrome {
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [workbenchSheetOpen, setWorkbenchSheetOpen] = useState(false);

  /**
   * 自绘窗口控件的纵向位置：展开时它落在侧栏顶部空区，中线取对话区头部那行的控件中线再减去
   * 内容卡距窗口顶的间距（点属窗口镶边，不该被内容卡的上留白推下去，那一段就是外壳容器
   * `p-shell-inset` 的顶边留白）；收起时它就在头部那一行里，中线直接取那行的控件中线（跟行对齐）。
   * 两种情况都是实测值，写到 `<html>` 上交给壳层，壳层的拖拽条读数定位——两边都不需要知道对方的几何。
   */
  useEffect(() => {
    if (titleBarInset === 0) return;
    const header = document.querySelector('[data-slot="chat-header"]');
    // 卡片就是头部的父节点，它距窗口顶的那一段就是要减掉的间距
    const card = header?.parentElement;
    if (!header || !card) return;
    // 对齐目标是头部里「真控件」的中线：要排掉窗口控件自己（它也挂在头部里，量它会自我引用）
    const anchor =
      Array.from(header.querySelectorAll("button")).find(
        (button) => !button.closest("[data-window-controls]"),
      ) ?? header;
    const overSidebar = isDesktop && !sidebarCollapsed;
    const publish = (): void => {
      const rect = anchor.getBoundingClientRect();
      const centered = rect.top + rect.height / 2;
      const line = overSidebar ? centered - card.getBoundingClientRect().top : centered;
      document.documentElement.style.setProperty("--window-controls-center", `${line}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    observer.observe(anchor);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--window-controls-center");
    };
  }, [isDesktop, sidebarCollapsed, titleBarInset]);

  // 拉宽到桌面断点时自动收起两个抽屉：抽屉内容有 `md:hidden` 会消失，遮罩没有，
  // 不收起来就会留下一层盖住全屏、且把 body 置为 pointer-events: none 的遮罩
  useEffect(() => {
    if (!isDesktop) return;
    setSidebarOpen(false);
    setWorkbenchSheetOpen(false);
  }, [isDesktop]);

  /** 收起 / 展开侧栏并落盘；移动端抽屉由 sidebarOpen 单独管 */
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeStorage(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return {
    isDesktop,
    sidebarOpen,
    setSidebarOpen,
    sidebarCollapsed,
    toggleSidebar,
    workbenchSheetOpen,
    setWorkbenchSheetOpen,
    headerOwnsLeftEdge: isDesktop ? sidebarCollapsed : !sidebarOpen,
  };
}
