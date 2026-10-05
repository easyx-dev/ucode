/**
 * 桌面外壳：导航状态只在本窗口内（无 URL 导航、无登录闸门）。
 *
 * 界面本体全部来自 `@ucode/ui`；本文件只负责导航状态的存放与默认选中。
 */
import { useSessions } from "@ucode/ui/hooks/use-sessions";
import { WorkspaceLayout } from "@ucode/ui/presets/workspace";
import { useEffect, useRef, useState } from "react";

export function DesktopApp() {
  const { sessions, loading } = useSessions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      sessionId={sessionId}
      onSelectSession={setSessionId}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      usageOpen={usageOpen}
      onUsageOpenChange={setUsageOpen}
    />
  );
}
