/**
 * 应用外壳：配对落地 + 登录闸门 + 把 URL 与工作区导航状态对齐。
 *
 * 登录态由 `client.auth` 探知；未登录先跳 `/login`，已登录停在登录页则回应用。
 * 配对链接（`?connect=<code>`）先把码换成 token 再探知，避免无凭证时先跳一次登录页。
 * web 专属的适配就是这层——会话与设置写进查询串，刷新 / 前进后退都能恢复。
 */
import { sessionTokenStorageKey } from "@ucode/brand";
import { errorMessageKey } from "@ucode/i18n";
import { Button } from "@ucode/ui/base/button";
import { LoginPage } from "@ucode/ui/business/login-page";
import { useAuth } from "@ucode/ui/hooks/use-auth";
import { useSessions } from "@ucode/ui/hooks/use-sessions";
import { useErrorText } from "@ucode/ui/lib/error";
import { isSettingsSectionId, type SettingsSectionId } from "@ucode/ui/lib/settings-section";
import { WorkspaceLayout } from "@ucode/ui/presets/workspace";
import { useClient } from "@ucode/ui/provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { redeemConnectCode } from "./lib/pairing";

const SESSION_KEY = "session";
const SETTINGS_KEY = "settings";
const LOGIN_PATH = "/login";

/** 导航状态：会话 id 与设置分区，分别写进 `?session=` 与 `?settings=` */
type Nav = { sessionId: string | null; settingsSection: SettingsSectionId | null };

const readQuery = (): Nav => {
  const params = new URLSearchParams(window.location.search);
  const section = params.get(SETTINGS_KEY);
  return {
    sessionId: params.get(SESSION_KEY),
    // 旧的 `?settings=1` 与拼错的分区都当没打开
    settingsSection: isSettingsSectionId(section) ? section : null,
  };
};

/** 写回 URL；用户主动切换用 push 保留历史，程序化纠偏用 replace 不污染历史 */
const writeQuery = (next: Nav, mode: "push" | "replace"): void => {
  const url = new URL(window.location.href);
  if (next.sessionId) url.searchParams.set(SESSION_KEY, next.sessionId);
  else url.searchParams.delete(SESSION_KEY);
  if (next.settingsSection) url.searchParams.set(SETTINGS_KEY, next.settingsSection);
  else url.searchParams.delete(SETTINGS_KEY);
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(null, "", target);
  else window.history.replaceState(null, "", target);
};

/** 登录后回跳目标：只接受本源的站内路径，挡掉 `//evil.com` 这类协议相对地址 */
const resolveNext = (raw: string | null): string => {
  if (!raw) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
};

export default function App() {
  const client = useClient();
  const auth = useAuth();
  const { t } = useTranslation();
  const loginRoute = window.location.pathname === LOGIN_PATH;

  // 首屏：先兑换配对码（若有）再探知登录态；码作废时带原因去登录页展示
  const boot = useCallback(async (): Promise<void> => {
    const result = await redeemConnectCode(client);
    if (result.status === "invalid") {
      window.location.replace(`${LOGIN_PATH}?error=${encodeURIComponent(result.errorCode)}`);
      return;
    }
    await client.auth.load();
  }, [client]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // 另一个标签登录 / 登出 / 改密码后本标签手里已是旧凭证：整页重载让事件流与各 store 重新装配
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === sessionTokenStorageKey) window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 未登录 → 去登录页；已登录停在登录页 → 回应用（整页跳转重新装配各 store）
  useEffect(() => {
    if (auth.status === "unknown") return;
    if (auth.status === "anonymous" && !loginRoute) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
      return;
    }
    if (auth.status === "authenticated" && loginRoute) {
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(resolveNext(next));
    }
  }, [auth.status, loginRoute]);

  if (loginRoute) {
    const errorCode = new URLSearchParams(window.location.search).get("error");
    const key = errorCode ? errorMessageKey(errorCode) : null;
    return <LoginPage notice={key ? t(key) : null} />;
  }

  if (auth.status !== "authenticated") {
    // 探知失败（网络不通 / 服务未启动）不是「未登录」，给一次重试，别把用户甩到登录页
    if (auth.status === "unknown" && auth.error) {
      return <ServiceUnreachable onRetry={() => void boot()} />;
    }
    return <div className="min-h-dvh bg-background" />;
  }

  return <AuthenticatedApp />;
}

/** 首屏探知失败的重试入口：错误文案取服务端封套里的原因；重试会连同待兑换的配对码一起重跑 */
function ServiceUnreachable({ onRetry }: { onRetry: () => void }) {
  const auth = useAuth();
  const { t } = useTranslation();
  const reason = useErrorText(auth.error);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm text-muted-foreground">{t("连接服务失败，请确认服务已启动。")}</p>
      {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t("重试")}
      </Button>
    </div>
  );
}

function AuthenticatedApp() {
  const initial = readQuery();
  const [sessionId, setSessionId] = useState(initial.sessionId);
  const [settingsSection, setSettingsSection] = useState(initial.settingsSection);
  const [usageOpen, setUsageOpen] = useState(false);
  const { sessions, loading } = useSessions();
  /** 默认选中只发生一次 */
  const picked = useRef(false);

  const selectSession = useCallback(
    (id: string | null) => {
      setSessionId(id);
      writeQuery({ sessionId: id, settingsSection }, "push");
    },
    [settingsSection],
  );

  const changeSettings = useCallback(
    (section: SettingsSectionId | null) => {
      setSettingsSection(section);
      // 开关设置入栈（后退可撑销），设置内切页只改查询串，避免后退要连按多次
      const switching = settingsSection !== null && section !== null;
      writeQuery({ sessionId, settingsSection: section }, switching ? "replace" : "push");
    },
    [sessionId, settingsSection],
  );

  // URL 未指定会话时，列表就绪后默认选中最近一个——只做一次
  useEffect(() => {
    if (picked.current || loading) return;
    picked.current = true;
    if (sessionId) return;
    const first = sessions[0];
    if (!first) return;
    setSessionId(first.id);
    writeQuery({ sessionId: first.id, settingsSection }, "replace");
  }, [loading, sessionId, sessions, settingsSection]);

  // 浏览器前进 / 后退：URL 是导航状态的事实源
  useEffect(() => {
    const onPopState = (): void => {
      const next = readQuery();
      setSessionId(next.sessionId);
      setSettingsSection(next.settingsSection);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <WorkspaceLayout
      sessionId={sessionId}
      onSelectSession={selectSession}
      settingsSection={settingsSection}
      onSettingsSectionChange={changeSettings}
      usageOpen={usageOpen}
      onUsageOpenChange={setUsageOpen}
    />
  );
}
