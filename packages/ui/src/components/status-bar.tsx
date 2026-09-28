import type { ReactNode } from "react";
import { useAgentStore } from "../context.ts";
import { AlertIcon } from "./icons.tsx";
import { formatTokenCount } from "./insights-format.ts";

/**
 * 状态条：连接、游标、用量、最近一条系统通知。
 *
 * 只保留"出问题时必须看见"的信息——正常运行时它几乎是空的，
 * 这样任何一条文字出现都会真的被读到（全都常显等于全都没人看）。
 */
export function StatusBar(): ReactNode {
  const connected = useAgentStore((store) => store.state.connected);
  const views = useAgentStore((store) => store.state.views);
  const activeSessionId = useAgentStore((store) => store.state.activeSessionId);
  const lastNotice = useAgentStore((store) => store.state.notices.at(-1));
  const view = activeSessionId === null ? undefined : views[activeSessionId];
  const usage = view?.usage as { totalTokens?: number; cost?: { total?: number } } | undefined;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 px-4 text-[10px] text-[var(--color-content-faint)]">
      <span className={connected ? "" : "text-[var(--color-warn)]"}>
        {connected ? "已连接" : "未连接，重连中…"}
      </span>
      {view !== undefined && <span>{view.state?.status ?? "idle"}</span>}
      {view !== undefined && <span>游标 {view.maxSeq}</span>}
      {usage?.totalTokens !== undefined && (
        <span>{formatTokenCount(usage.totalTokens)} tokens</span>
      )}
      {usage?.cost?.total !== undefined && <span>成本 {usage.cost.total.toFixed(4)}</span>}
      {view?.needsResync === true && (
        <span className="flex items-center gap-1 text-[var(--color-warn)]">
          <AlertIcon className="size-3" />
          需要全量重新同步
        </span>
      )}
      {lastNotice !== undefined && (
        <span
          className={`ml-auto truncate ${
            lastNotice.level === "error" ? "text-[var(--color-danger)]" : ""
          }`}
        >
          {lastNotice.message}
        </span>
      )}
    </footer>
  );
}
