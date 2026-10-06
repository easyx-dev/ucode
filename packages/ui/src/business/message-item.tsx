/**
 * 单条消息的内容渲染：用户气泡、assistant 内容段（正文 / 思考 / 图片 / 附件）与摘要 / 扩展条目。
 * 工具调用已由 chat-nodes 抽成独立节点，这里只渲染非工具内容；`trailing` 表示该段是否是来源消息的最后一段。
 */
import { API_BASE_PATH } from "@ucode/contracts";
import { Brain, ChevronRight, FileText, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../base/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../base/collapsible";
import { parseUserMessage } from "../lib/message-chips";
import { isPlanIgnored } from "../lib/plan";
import { durationLabel } from "../lib/time";
import type { ChatItem, MessageBlock } from "../lib/types";
import { ForkAction, MessageFooter } from "./message-footer";
import { ThinkingIndicator } from "./thinking-indicator";

function ThinkingBlock({ text, thinkingMs }: { text: string; thinkingMs?: number }) {
  const { t } = useTranslation();

  return (
    <Collapsible className="my-2">
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <Brain className="size-3.5" />
        {t("思考过程")}
        {thinkingMs !== undefined ? (
          <span className="text-[11px] text-muted-foreground/70">{durationLabel(thinkingMs)}</span>
        ) : null}
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 border-l-2 border-muted pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function BlockView({
  block,
  live,
  thinkingMs,
}: {
  block: MessageBlock;
  live?: boolean;
  thinkingMs?: number;
}) {
  if (block.type === "thinking") return <ThinkingBlock text={block.text} thinkingMs={thinkingMs} />;
  // 工具调用已由独立节点渲染，这里不再兜底
  if (block.type === "toolCall") return null;
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
  blocks,
  trailing = true,
  turnEnd = true,
  durationMs,
  onFork,
  onEdit,
  isLastUser,
}: {
  item: ChatItem;
  /** 覆盖渲染的内容块（assistant 被拆成多段时只渲染其中一段）；缺省渲染整条消息 */
  blocks?: MessageBlock[];
  /** 是否为来源消息的最后一段；流式光标只挂在最后一段上 */
  trailing?: boolean;
  /** 是否为「一轮回复」的最后一段；页脚、耗时与分叉入口据此只出现一次 */
  turnEnd?: boolean;
  /** 本轮回复的总耗时（毫秒） */
  durationMs?: number;
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
  const content = blocks ?? item.blocks;
  const canFork = Boolean(onFork) && !item.live;
  const canEdit = Boolean(onEdit) && item.role === "user" && !item.live;

  const startEdit = () => {
    const text = content.map((block) => (block.type === "text" ? block.text : "")).join("");
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
    const rawText = content.map((block) => (block.type === "text" ? block.text : "")).join("");
    const parsed = parseUserMessage(rawText);
    const media = content.filter((block) => block.type === "image" || block.type === "file");
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
              <p className="text-[11px] text-muted-foreground">
                {t("发送后将移除这条消息之后的内容（仍保留在会话记录中）。")}
              </p>
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
          {parsed.skill || parsed.contexts.length > 0 || parsed.attachments.length > 0 ? (
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
              {parsed.attachments.map((attachment, index) => (
                <a
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同一文件可被引用多次，位置即身份
                  key={`${item.id}-att-${index}`}
                  href={`${API_BASE_PATH}/attachments/${attachment.id}`}
                  download={attachment.name}
                  title={attachment.name}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <FileText className="size-3 shrink-0" />
                  {attachment.name}
                </a>
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

  // 忽略计划的界面标记：沿用 muted 便签，不带「（扩展消息）」前缀
  if (isPlanIgnored(item)) {
    return (
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/10">
        {t("已忽略计划")}
      </div>
    );
  }

  if (item.role === "summary" || item.role === "custom") {
    const text = content.map((block) => (block.type === "text" ? block.text : "")).join("");
    return (
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground ring-1 ring-foreground/10">
        {item.role === "summary" ? t("（上下文已压缩）") : t("（扩展消息）")} {text.slice(0, 400)}
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 space-y-1">
      {content.map((block, index) => (
        <BlockView
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks 是按顺序追加的内容块，没有自然 id，位置即身份
          key={`${item.id}-${index}`}
          block={block}
          live={item.live && trailing && index === content.length - 1}
          thinkingMs={item.timing?.thinkingMs}
        />
      ))}
      {item.live && content.length === 0 ? <ThinkingIndicator /> : null}
      {turnEnd ? <MessageFooter item={item} durationMs={durationMs} onFork={onFork} /> : null}
    </div>
  );
}
