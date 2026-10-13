/**
 * 全局快捷键：⌘K 搜索、⌘B 切换侧栏、⌘O 打开工作区、⌘N 新建任务。
 */
import { useEffect, useRef } from "react";

export type WorkspaceShortcuts = {
  onTogglePalette: () => void;
  onToggleSidebar: () => void;
  onOpenWorkspace: () => void;
  onNewSession: () => void;
};

/** 浏览器可能保留 ⌘N，因此这里只做尽力拦截；⌘K / ⌘B / ⌘O 都自己接管 */
export function useWorkspaceShortcuts(handlers: WorkspaceShortcuts): void {
  // 动作随当前会话每次重建，用 ref 取最新，避免反复解绑 / 绑定全局监听
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case "k":
          event.preventDefault();
          latest.current.onTogglePalette();
          break;
        case "b":
          event.preventDefault();
          latest.current.onToggleSidebar();
          break;
        case "o":
          event.preventDefault();
          latest.current.onOpenWorkspace();
          break;
        case "n":
          event.preventDefault();
          latest.current.onNewSession();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
