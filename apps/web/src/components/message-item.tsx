import { Brain, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ToolCallCard } from "@/components/tool-call-card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { clockLabel } from "@/lib/time";
import type { ChatItem, MessageBlock } from "@/lib/types";

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

export function MessageItem({ item }: { item: ChatItem }) {
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
      />
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
      {item.live && item.blocks.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
          {t("思考中…")}
        </div>
      ) : null}
      {!item.live && item.model ? (
        <div className="text-xs text-muted-foreground">
          {item.model} · {clockLabel(item.createdAt)}
        </div>
      ) : null}
    </div>
  );
}
