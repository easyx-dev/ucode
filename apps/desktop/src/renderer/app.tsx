/**
 * 桌面外壳：导航状态只在本窗口内（无 URL 导航、无登录闸门）。
 *
 * 界面本体全部来自 `@ucode/ui`；本文件只负责导航状态的存放与默认选中。
 */
import { useSessions } from "@ucode/ui/hooks/store/use-sessions";
import { WorkspaceLayout } from "@ucode/ui/presets/workspace";
import type { WorkbenchBrowserSurface } from "@ucode/ui/provider";
import type { SettingsSectionId } from "@ucode/ui/utils/settings-section";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserPanel } from "./components/browser-panel";
import { BrowserSidebar } from "./components/browser-sidebar";
import { WindowControls } from "./components/window-controls";
import { titleBarInset, windowControlsWidth } from "./lib/window-chrome";

export function DesktopApp() {
  const { sessions, loading } = useSessions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  /** 默认选中只发生一次 */
  const picked = useRef(false);

  // 列表就绪后默认选中最近一个会话
  useEffect(() => {
    if (picked.current || loading) return;
    picked.current = true;
    if (sessionId) return;
    const first = sessions[0];
    if (first) setSessionId(first.id);
  }, [loading, sessionId, sessions]);

  /*
    工作台里的浏览器：载体是 Electron 的 `<webview>`，所以只有桌面端才有这一面——面板、侧栏都在本目录里，
    `@ucode/ui` 只提供注入位（web 端不传，工作台里就没有浏览器视图）。
  */
  const browser = useMemo<WorkbenchBrowserSurface>(
    () => ({
      sidebar: <BrowserSidebar />,
      renderTab: (tabId, { active }) => <BrowserPanel key={tabId} tabId={tabId} active={active} />,
    }),
    // 稳定引用：工作台的动作面按它做 memo，每次渲染换新会把整个工作台重算一遍
    [],
  );

  return (
    <WorkspaceLayout
      browser={browser}
      // 桌面端的侧栏顶部是自绘窗口控件与拖拽条的地盘，不再露品牌区（见 `WorkspaceLayoutProps.showBrand`）
      showBrand={false}
      titleBarInset={titleBarInset()}
      windowControlsWidth={windowControlsWidth()}
      windowControls={<WindowControls />}
      sessionId={sessionId}
      onSelectSession={setSessionId}
      settingsSection={settingsSection}
      onSettingsSectionChange={setSettingsSection}
      usageOpen={usageOpen}
      onUsageOpenChange={setUsageOpen}
    />
  );
}
