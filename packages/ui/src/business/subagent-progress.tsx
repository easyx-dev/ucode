/**
 * 子智能体的内联内容：进行中时是它的实时进度，结束后是回看入口。
 *
 * 子会话不能再派子智能体，嵌套视图不再下传 subagents / onFork / onEdit；也不做虚拟滚动——它折在一行里，
 * 高度由父行的测量统一覆盖。
 */
import { Bot } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildChatRows } from "../lib/chat-rows";
import type { SubagentStream } from "../lib/types";
import { MessageRow } from "./message-row";

export function SubagentProgress({
  stream,
  onOpenSession,
}: {
  stream: SubagentStream;
  onOpenSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => buildChatRows(stream.items), [stream.items]);
  const status = stream.done ? (stream.isError ? t("失败") : t("完成")) : t("执行中");

  return (
    <div className="border-t border-border pt-2">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Bot className="size-3.5 shrink-0" />
        <span className="shrink-0">{t("子智能体过程")}</span>
        {stream.description ? (
          <span className="truncate text-foreground/70">{stream.description}</span>
        ) : null}
        <span className="ml-auto shrink-0">{status}</span>
        {onOpenSession && stream.sessionId ? (
          <button
            type="button"
            className="shrink-0 text-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onOpenSession(stream.sessionId)}
          >
            {t("打开子会话")}
          </button>
        ) : null}
      </div>
      <div className="-ml-4 border-l-2 border-border">
        {rows.map((row) => (
          <MessageRow key={row.key} row={row} context={{}} />
        ))}
      </div>
    </div>
  );
}

/**
 * 子会话结束后的回看入口：进度快照里已经没有它，只有工具结果留着 `task_id`。
 * 与进行中的「打开子会话」同一个去向（详情小窗），所以口径保持一致。
 */
export function SubagentSessionLink({
  sessionId,
  onOpenSession,
}: {
  sessionId: string;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-border pt-2">
      <button
        type="button"
        className="rounded text-xs text-foreground/70 underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => onOpenSession(sessionId)}
      >
        {t("查看子会话")}
      </button>
    </div>
  );
}
