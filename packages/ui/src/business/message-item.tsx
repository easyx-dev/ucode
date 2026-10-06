/**
 * 单条消息的内容渲染：用户消息、assistant 内容段（正文 / 思考 / 图片 / 附件）与摘要 / 扩展条目。
 *
 * 工具调用与思考区块已由 chat-nodes 抽成 activity 聚合行，这里只渲染正文 / 图片 / 附件；
 * `trailing` 表示该段是否是来源消息的最后一段。
 * 用户消息用浅底细边框而非反色气泡，操作与时刻悬停才现。
 */
import { API_BASE_PATH } from "@ucode/contracts";
import { FileText, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../base/button";
import type { ChatFooter } from "../lib/chat-nodes";
import { parseUserMessage } from "../lib/message-chips";
import { isPlanIgnored } from "../lib/plan";
import { clockLabel } from "../lib/time";
import type { ChatItem, MessageBlock } from "../lib/types";
import { ForkAction, MessageFooter } from "./message-footer";

function BlockView({ block, live }: { block: MessageBlock; live?: boolean }) {
  // 思考区块与工具调用已由 activity 聚合行渲染，这里不再兜底
  if (block.type === "thinking" || block.type === "toolCall") return null;
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
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
  footer,
  onFork,
  onEdit,
  isLastUser,
}: {
  item: ChatItem;
  /** 覆盖渲染的内容块（assistant 被拆成多段时只渲染其中一段）；缺省渲染整条消息 */
  blocks?: MessageBlock[];
  /** 是否为来源消息的最后一段；流式光标只挂在最后一段上 */
  trailing?: boolean;
  /** 该轮页脚（模型 / 耗时与分叉入口）；只落在轮末那一行上，缺省不渲染 */
  footer?: ChatFooter;
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
              className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
        <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {clockLabel(item.createdAt)}
        </span>
        <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {canEdit ? <EditAction onClick={startEdit} /> : null}
          {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
        </span>
        <div className="flex max-w-[85%] flex-col items-end gap-1.5">
          {parsed.skill || parsed.attachments.length > 0 ? (
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
            <div className="rounded-lg rounded-br-sm border border-border bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
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
    <div className="group min-w-0 flex-1 space-y-2">
      {content.map((block, index) => (
        <BlockView
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks 是按顺序追加的内容块，没有自然 id，位置即身份
          key={`${item.id}-${index}`}
          block={block}
          live={item.live && trailing && index === content.length - 1}
        />
      ))}
      {footer ? (
        <MessageFooter item={footer.item} durationMs={footer.durationMs} onFork={onFork} />
      ) : null}
    </div>
  );
}
