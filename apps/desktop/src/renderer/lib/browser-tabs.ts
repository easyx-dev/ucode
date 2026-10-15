/**
 * 浏览器标签状态的上报（渲染层）：每个面板报自己那一格，这里合起来整份发给主进程，由它转给服务端。
 *
 * 为什么用模块级表而不是 React 状态：面板是分散挂载的（一个标签一个），而服务端要的是整份列表——
 * 中间这层聚合不参与渲染，进 React 只会让每次导航多一次全树重渲染。主进程按 `id` 覆盖，
 * 所以「整份重发」与「只发自己那格」等价，这里两者都做：状态变了发整份，面板卸载时删掉自己那一格。
 *
 * 攒 200ms 再发：导航过程中 url / 标题会连着变好几轮，服务端不需要中间的每一轮。
 */
import type { DesktopBrowserTab } from "@ucode/contracts";
import { useEffect } from "react";

const FLUSH_DELAY_MS = 200;

const reported = new Map<string, Omit<DesktopBrowserTab, "id">>();
let timer: ReturnType<typeof setTimeout> | null = null;

const flush = (): void => {
  timer = null;
  const tabs: DesktopBrowserTab[] = [...reported.entries()].map(([id, state]) => ({
    id,
    ...state,
  }));
  window.desktop.reportBrowserTabs(tabs);
};

const schedule = (): void => {
  if (timer !== null) return;
  timer = setTimeout(flush, FLUSH_DELAY_MS);
};

/** 面板报自己那一格（id 由调用方给，重复报即覆盖） */
const reportBrowserTab = (tab: DesktopBrowserTab): void => {
  const { id, ...state } = tab;
  reported.set(id, state);
  schedule();
};

const forgetBrowserTab = (id: string): void => {
  reported.delete(id);
  schedule();
};

export function useBrowserTabReport(tab: DesktopBrowserTab): void {
  const { id, title, url, webContentsId, active } = tab;
  useEffect(() => {
    reportBrowserTab({ id, title, url, webContentsId, active });
  }, [id, title, url, webContentsId, active]);

  // 标签关掉（或换会话清空）时把那一格摘掉：卸载即销毁 webview，服务端不该再看到它
  useEffect(() => () => forgetBrowserTab(id), [id]);
}
