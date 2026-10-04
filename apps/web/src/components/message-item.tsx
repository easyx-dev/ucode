import { Bot, Brain, ChevronRight, FileText, GitFork, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ThinkingIndicator } from "@/components/thinking-indicator";
import { ToolCallCard } from "@/components/tool-call-card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { parseUserMessage } from "@/lib/message-chips";
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
  if (block.type === "image") {
    return (
      <a href={block.url} target="_blank" rel="noreferrer" className="my-2 inline-block">
        <img
          src={block.url}
          alt=""
          loading="lazy"
          className="max-h-96 rounded-md border border-border"
        />
      </a>
    );
  }
  if (block.type === "file") {
    return (
      <a
        href={block.url}
        download={block.name}
        className="my-1 inline-flex items-center rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {block.name}
      </a>
    );
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
function SubagentProgress({
  stream,
  onOpenSession,
}: {
  stream: SubagentStream;
  onOpenSession?: (sessionId: string) => void;
}) {
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
      <div className="space-y-3 border-l-2 border-border pl-3">
        {stream.items.map((item) => (
          // 子会话不能再派子智能体，嵌套不会再出现子进度
          <MessageItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

/** 一条消息悬停时出现的分叉入口：从该条消息抽出新会话 */
function ForkAction({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="shrink-0 self-center rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground"
      title={t("从此分叉")}
      onClick={onClick}
    >
      <GitFork className="size-3.5" />
    </button>
  );
}

/** 用户消息悬停时的编辑入口：行内改写并重发 */
function EditAction({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="shrink-0 self-center rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground"
      title={t("编辑并重新发送")}
      onClick={onClick}
    >
      <Pencil className="size-3.5" />
    </button>
  );
}

export function MessageItem({
  item,
  subagent,
  onOpenSession,
  onFork,
  onEdit,
  isLastUser,
}: {
  item: ChatItem;
  /** 该条工具结果的子智能体内联进度（仅 subagent 工具调用会有） */
  subagent?: SubagentStream;
  /** 打开子会话；子会话自身的嵌套消息不再下传 */
  onOpenSession?: (sessionId: string) => void;
  /** 从该条消息分叉；只有主对话传入，子智能体嵌套视图不提供 */
  onFork?: (item: ChatItem) => void;
  /** 编辑该条用户消息并重发；成功后由事件刷新，返回是否已受理 */
  onEdit?: (item: ChatItem, text: string) => Promise<boolean>;
  /** 是否为本会话最后一条用户消息；非最后一条会提示其后内容将被移除 */
  isLastUser?: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const canFork = Boolean(onFork) && !item.live;
  const canEdit = Boolean(onEdit) && item.role === "user" && !item.live;

  const startEdit = () => {
    const text = item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    setDraft(text);
    setEditing(true);
  };

  const submitEdit = async () => {
    const text = draft.trim();
    if (!text || !onEdit || saving) return;
    setSaving(true);
    const ok = await onEdit(item, text);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (item.role === "user") {
    const rawText = item.blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    const parsed = parseUserMessage(rawText);
    const media = item.blocks.filter((block) => block.type === "image" || block.type === "file");
    if (editing) {
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[85%] space-y-1.5">
            <textarea
              // biome-ignore lint/a11y/noAutofocus: 点击编辑后焦点应直接落在待改写的输入区
              autoFocus
              rows={3}
              className="w-full resize-y rounded-2xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditing(false);
                // 与输入区一致：Enter 换行，Cmd/Ctrl+Enter 发送
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submitEdit();
                }
              }}
            />
            {isLastUser === false ? (
              <p className="text-[11px] text-muted-foreground">{t("编辑后移除提示")}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("取消")}
              </Button>
              <Button
                size="sm"
                disabled={!draft.trim() || saving}
                onClick={() => void submitEdit()}
              >
                {t("发送")}
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="group flex items-center justify-end gap-1">
        {canEdit ? <EditAction onClick={startEdit} /> : null}
        {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
        <div className="flex max-w-[85%] flex-col items-end gap-1.5">
          {parsed.skill || parsed.contexts.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {parsed.skill ? (
                <span
                  title={t("技能")}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <Sparkles className="size-3 shrink-0" />
                  {parsed.skill.name}
                </span>
              ) : null}
              {parsed.contexts.map((context, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同一文件可被引用多次，位置即身份
                  key={`${item.id}-ctx-${index}`}
                  title={t("文件")}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <FileText className="size-3 shrink-0" />
                  {context.lines ? `${context.path}:${context.lines}` : context.path}
                </span>
              ))}
            </div>
          ) : null}
          {media.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {media.map((block, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 附件块按顺序排列，位置即身份
                <BlockView key={`${item.id}-media-${index}`} block={block} />
              ))}
            </div>
          ) : null}
          {parsed.text ? (
            <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
              {parsed.text}
            </div>
          ) : null}
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
        {subagent ? <SubagentProgress stream={subagent} onOpenSession={onOpenSession} /> : null}
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
    <div className="group flex items-start gap-1">
      <div className="min-w-0 flex-1 space-y-1">
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
      {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
    </div>
  );
}
