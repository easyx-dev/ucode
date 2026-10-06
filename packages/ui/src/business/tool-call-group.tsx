/**
 * 连续工具调用的聚合卡片：摘要头给出调用总数、分类计数与失败数，展开后逐条看具体调用。
 * 组内只有一次调用时直接显示单卡，不套摘要；运行 / 出错时自动展开，用户点选后以用户为准。
 * 本轮若以工具调用收尾，页脚（模型 / 时间 / 耗时）挂在卡片下方。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import { ChevronRight, CircleDashed, TriangleAlert, Wrench } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../base/collapsible";
import type { ChatFooter, ToolEntry } from "../lib/chat-nodes";
import { summarizeToolEntries, type ToolBucket } from "../lib/tool-view";
import type { ChatItem } from "../lib/types";
import { MessageFooter } from "./message-footer";
import { ToolCall } from "./tool-call";

const bucketLabelOf = (bucket: ToolBucket, t: TFunction): string => {
  switch (bucket) {
    case "read":
      return t("读");
    case "write":
      return t("写");
    case "command":
      return t("执行");
    case "search":
      return t("搜索");
    case "network":
      return t("网络");
    default:
      return t("其他");
  }
};

type ToolCallGroupProps = {
  entries: ToolEntry[];
  /** 本轮以工具调用收尾时的页脚 */
  footer?: ChatFooter;
  /** 每个条目追加的内容（如子智能体内联进度） */
  renderExtra?: (entry: ToolEntry) => ReactNode;
  /** 从该条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
};

export function ToolCallGroup({ entries, footer, renderExtra, onFork }: ToolCallGroupProps) {
  const { t } = useTranslation();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const summary = summarizeToolEntries(entries);
  const running = entries.some((entry) => entry.running);
  const auto = running || summary.failed > 0;
  const open = userOpen ?? auto;
  const footerNode = footer ? (
    <div className="border-t border-border px-3 py-1.5">
      <MessageFooter item={footer.item} durationMs={footer.durationMs} onFork={onFork} />
    </div>
  ) : null;

  if (entries.length === 1) {
    const entry = entries[0];
    if (!entry) return null;
    return (
      <div className="my-2 overflow-hidden rounded-lg bg-muted/50 ring-1 ring-foreground/10">
        <ToolCall entry={entry}>{renderExtra?.(entry)}</ToolCall>
        {footerNode}
      </div>
    );
  }

  const breakdown = summary.buckets
    .map((item) => `${bucketLabelOf(item.bucket, t)} ${item.count}`)
    .join(" · ");

  return (
    <div className="my-2 overflow-hidden rounded-lg bg-muted/50 ring-1 ring-foreground/10">
      <Collapsible open={open} onOpenChange={setUserOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none">
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-xs font-medium">
            {t("工具调用 {{value}} 次", { value: summary.total })}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <span className="truncate">{breakdown}</span>
            {summary.failed > 0 ? (
              <>
                <span className="shrink-0" aria-hidden>
                  ·
                </span>
                <span className="flex shrink-0 items-center gap-1 text-destructive">
                  <TriangleAlert className="size-3" />
                  {t("失败")} {summary.failed}
                </span>
              </>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {running ? (
              <CircleDashed className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="divide-y divide-border border-t border-border">
            {entries.map((entry) => (
              <ToolCall key={entry.id} entry={entry} defaultOpen>
                {renderExtra?.(entry)}
              </ToolCall>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {footerNode}
    </div>
  );
}
