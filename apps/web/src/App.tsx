/**
 * 应用外壳：把 URL 与工作区导航状态对齐，其余交给 `@ucode/ui` 的预设。
 *
 * web 专属的适配就是这层——会话与设置写进查询串，刷新 / 前进后退都能恢复；
 * 桌面端会换成按窗口的导航，TUI 则不用这套 React 组合。
 */
import { useSessions } from "@ucode/ui/hooks/use-sessions";
import { WorkspaceLayout } from "@ucode/ui/presets/workspace";
import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_KEY = "session";
const SETTINGS_KEY = "settings";

type Nav = { sessionId: string | null; settingsOpen: boolean };

const readQuery = (): Nav => {
  const params = new URLSearchParams(window.location.search);
  return { sessionId: params.get(SESSION_KEY), settingsOpen: params.get(SETTINGS_KEY) === "1" };
};

/** 写回 URL；用户主动切换用 push 保留历史，程序化纠偏用 replace 不污染历史 */
const writeQuery = (next: Nav, mode: "push" | "replace"): void => {
  const url = new URL(window.location.href);
  if (next.sessionId) url.searchParams.set(SESSION_KEY, next.sessionId);
  else url.searchParams.delete(SESSION_KEY);
  if (next.settingsOpen) url.searchParams.set(SETTINGS_KEY, "1");
  else url.searchParams.delete(SETTINGS_KEY);
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(null, "", target);
  else window.history.replaceState(null, "", target);
};

export default function App() {
  const initial = readQuery();
  const [sessionId, setSessionId] = useState(initial.sessionId);
  const [settingsOpen, setSettingsOpen] = useState(initial.settingsOpen);
  const [usageOpen, setUsageOpen] = useState(false);
  const { sessions, loading } = useSessions();
  /** 默认选中只发生一次 */
  const picked = useRef(false);

  const selectSession = useCallback(
    (id: string | null) => {
      setSessionId(id);
      writeQuery({ sessionId: id, settingsOpen }, "push");
    },
    [settingsOpen],
  );

  const changeSettings = useCallback(
    (open: boolean) => {
      setSettingsOpen(open);
      writeQuery({ sessionId, settingsOpen: open }, "push");
    },
    [sessionId],
  );

  // URL 未指定会话时，列表就绪后默认选中最近一个——只做一次
  useEffect(() => {
    if (picked.current || loading) return;
    picked.current = true;
    if (sessionId) return;
    const first = sessions[0];
    if (!first) return;
    setSessionId(first.id);
    writeQuery({ sessionId: first.id, settingsOpen }, "replace");
  }, [loading, sessionId, sessions, settingsOpen]);

  // 浏览器前进 / 后退：URL 是导航状态的事实源
  useEffect(() => {
    const onPopState = (): void => {
      const next = readQuery();
      setSessionId(next.sessionId);
      setSettingsOpen(next.settingsOpen);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <WorkspaceLayout
      sessionId={sessionId}
      onSelectSession={selectSession}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={changeSettings}
      usageOpen={usageOpen}
      onUsageOpenChange={setUsageOpen}
    />
  );
}
