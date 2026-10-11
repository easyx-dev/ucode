/**
 * 桌面外壳：导航状态只在本窗口内（无 URL 导航、无登录闸门）。
 *
 * 界面本体全部来自 `@ucode/ui`；本文件只负责导航状态的存放与默认选中。
 */
import { useSessions } from "@ucode/ui/hooks/use-sessions";
import type { SettingsSectionId } from "@ucode/ui/lib/settings-section";
import { WorkspaceLayout } from "@ucode/ui/presets/workspace";
import { useEffect, useRef, useState } from "react";
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

  return (
    <WorkspaceLayout
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
