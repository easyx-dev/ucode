import { Bot, Brain, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ThinkingIndicator } from "@/components/thinking-indicator";
import { ToolCallCard } from "@/components/tool-call-card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { thinkingLevelLabel } from "@/lib/thinking";
import { clockLabel } from "@/lib/time";
import type { ChatItem, MessageBlock, SubagentStream } from "@/lib/types";

function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation();

  return (
    <Collapsible className="my-2">
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <Brain className="size-3.5" />
        {t("思考过程")}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 border-l-2 border-muted pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function BlockView({ block, live }: { block: MessageBlock; live?: boolean }) {
  if (block.type === "thinking") return <ThinkingBlock text={block.text} />;
  if (block.type === "toolCall") {
    return <ToolCallCard name={block.name} args={block.args} running={live} />;
  }
  return (
    <div className="md-content">
      <Markdown remarkPlugins={[remarkGfm]}>{block.text}</Markdown>
      {live ? (
        <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse bg-foreground align-text-bottom" />
      ) : null}
    </div>
  );
}

/** 子智能体的内联进度：子会话自己的消息，折叠在父会话的工具卡里 */
function SubagentProgress({ stream }: { stream: SubagentStream }) {
  const { t } = useTranslation();
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
      </div>
      <div className="space-y-3 border-l-2 border-border pl-3">
        {stream.items.map((item) => (
          // 子会话不能再派子智能体，嵌套不会再出现子进度
          <MessageItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

export function MessageItem({
  item,
  subagent,
}: {
  item: ChatItem;
  /** 该条工具结果的子智能体内联进度（仅 subagent 工具调用会有） */
  subagent?: SubagentStream;
}) {
  const { t } = useTranslation();
  if (item.role === "user") {
    const text = item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
          {text}
        </div>
      </div>
    );
  }

  if (item.role === "tool") {
    const text = item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    return (
      <ToolCallCard
        name={item.toolName ?? "tool"}
        result={text}
        isError={item.isError}
        running={item.live}
      >
        {subagent ? <SubagentProgress stream={subagent} /> : null}
      </ToolCallCard>
    );
  }

  if (item.role === "summary" || item.role === "custom") {
    const text = item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    return (
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/10">
        {item.role === "summary" ? t("上下文已压缩") : t("扩展消息")} {text.slice(0, 400)}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {item.blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks 是按顺序追加的内容块，没有自然 id，位置即身份
        <BlockView key={`${item.id}-${index}`} block={block} live={item.live} />
      ))}
      {item.live && item.blocks.length === 0 ? <ThinkingIndicator /> : null}
      {!item.live && item.model ? (
        <div className="text-xs text-muted-foreground">
          {[
            item.provider ? `${item.provider}/${item.model}` : item.model,
            // 「关闭」不代表推理，无展示价值；只在真的启用了推理时补上档位
            item.thinkingLevel && item.thinkingLevel !== "off"
              ? thinkingLevelLabel(item.thinkingLevel, t)
              : "",
            clockLabel(item.createdAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
