/**
 * 「思考 + 工具调用」的聚合行。
 *
 * 默认只占一行灰字摘要（「思考了 3 次，使用了 2 个 Shell，1 个 编辑」），展开才按原文顺序回看每一段思考与
 * 每一次调用。一段回复里动辄几十次「想一下、调一次工具」，逐条铺开会把真正的回答挤出屏幕。
 *
 * 行不带底色、不带图标，靠悬停时才现的小三角说明可点；**任何层级都不自动展开**——失败与否由展开后的
 * 各条自带的状态图标表达，要不要看细节由用户决定。整组只有一次工具调用时没必套摘要，直接铺成一行工具行。
 */
import { cn } from "cn";
import type { TFunction } from "i18next";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../base/collapsible";
import type { ChatItem } from "../../../types";
import { durationLabel } from "../../../utils/time";
import type { ChatFooter, ChatLeg, ToolEntry } from "../message/chat-nodes";
import { MessageFooter } from "../message/message-footer";
import { ToolCall, toolTitleOf } from "./tool-call";
import { summarizeToolNames } from "./tool-view";

/** 摘要里最多列出几种工具，超出的用「等」收尾 */
const MAX_SUMMARY_KINDS = 4;

/**
 * 一段思考：展开聚合行后仍是单行，自己再展开才看正文。
 *
 * 用具名 group（`group/thought`）：无名 group 会被外层聚合行的悬停点亮，让整列箭头一起现形。
 */
function ThinkingRow({ text, thinkingMs }: { text: string; thinkingMs?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible className="group/thought" open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex h-8 items-center gap-2 text-left text-xs text-foreground-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none">
        <span>{t("思考过程")}</span>
        {thinkingMs !== undefined ? (
          <span className="shrink-0 tabular-nums">{durationLabel(thinkingMs)}</span>
        ) : null}
        <ChevronRight
          className={cn(
            "size-icon-sm shrink-0 opacity-0 transition group-hover/thought:opacity-100 group-data-[state=open]/thought:opacity-100",
            open && "rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="py-1 pr-1.5 pl-6 text-xs leading-relaxed break-words whitespace-pre-wrap">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** 摘要文案：有思考就报次数，有工具就报各用了几个，两者都有时用逗号连起来 */
const summaryOf = (legs: ChatLeg[], t: TFunction): string => {
  const thoughts = legs.filter((leg) => leg.kind === "thought").length;
  const tools = legs.flatMap((leg) => (leg.kind === "tool" ? [leg.entry] : []));
  const names = summarizeToolNames(tools);
  const shown = names
    .slice(0, MAX_SUMMARY_KINDS)
    .map((item) =>
      t("{{value}} 个 {{name}}", { value: item.count, name: toolTitleOf(item.name, t) }),
    );
  // 各工具项自带数字，用逗号而非「A、B 和 C」分隔，免得「和」与后面的数字挤在一起
  const list = shown.join(t("，"));
  const used = names.length > shown.length ? `${list}${t("等")}` : list;

  if (thoughts > 0 && used)
    return t("思考了 {{think}} 次，使用了 {{used}}", { think: thoughts, used });
  if (thoughts > 0) return t("思考了 {{value}} 次", { value: thoughts });
  return t("使用了 {{used}}", { used });
};

type ActivityGroupProps = {
  legs: ChatLeg[];
  /** 本轮以此收尾时的页脚 */
  footer?: ChatFooter;
  /** 工具行内的尾部入口（如子智能体的「查看进度」）；收起状态下也看得见 */
  renderTrailing?: (entry: ToolEntry) => ReactNode;
  /** 从该条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
};

export function ActivityGroup({ legs, footer, renderTrailing, onFork }: ActivityGroupProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const only = legs.length === 1 ? legs[0] : undefined;
  const summary = useMemo(() => summaryOf(legs, t), [legs, t]);
  const footerNode = footer ? (
    <MessageFooter item={footer.item} durationMs={footer.durationMs} onFork={onFork} />
  ) : null;

  if (only?.kind === "tool") {
    return (
      <div className="group">
        <ToolCall entry={only.entry} trailing={renderTrailing?.(only.entry)} />
        {footerNode}
      </div>
    );
  }

  return (
    <div className="group">
      <Collapsible className="group/activity" open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex h-8 max-w-full items-center gap-2 text-left text-xs text-foreground-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none">
          <span className="truncate" title={summary}>
            {summary}
          </span>
          <ChevronRight
            className={cn(
              "size-icon-sm shrink-0 opacity-0 transition group-hover/activity:opacity-100 group-data-[state=open]/activity:opacity-100",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="pt-1 pb-1 pl-3">
            {legs.map((leg) =>
              leg.kind === "thought" ? (
                <ThinkingRow
                  key={leg.key}
                  text={leg.text}
                  thinkingMs={leg.item.timing?.thinkingMs}
                />
              ) : (
                <ToolCall key={leg.key} entry={leg.entry} trailing={renderTrailing?.(leg.entry)} />
              ),
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {footerNode}
    </div>
  );
}
