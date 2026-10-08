/**
 * 用户消息：句子外的 chip（技能 / 命令 / 附件）+ 正文里的引用 chip + 气泡与底部操作行。
 *
 * 引用在正文里是句子成分，所以在用户写的那句里就地渲染成可点 chip（点开右侧工作台预览）；
 * 技能、命令与附件不属于任何句子，统一排在气泡上方。时刻与操作（分叉 / 编辑 / 复制）落在气泡下方，
 * 常驻占位、悬停才现，出现时不顶动内容。
 *
 * 正文超过一段高度就折叠（底部渐隐 + 展开入口）：用户贴整段日志时不该把屏幕占满。
 * 编辑态是一块行内输入区，改写后重发（旧分支留在会话文件里）。
 */

import type { EditMessagePayload } from "@ucode/sdk";
import { cn } from "cn";
import { Pencil, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import {
  contextMarker,
  contextRefsOf,
  type ParsedUserMessage,
  parseUserMessage,
  userMessageText,
} from "../lib/message-chips";
import { resolveFromCwd } from "../lib/path";
import { clockLabel } from "../lib/time";
import type { ChatItem, MessageBlock } from "../lib/types";
import { useWorkbench } from "../provider/workbench";
import { AttachmentLink, BlockView } from "./message-blocks";
import { CopyAction, ForkAction } from "./message-footer";

/** 四类 chip 共用一套外观：句子外的技能 / 命令 / 附件与句子里的引用都长这样 */
const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground";

/** 折叠阈值：超过这个高度的正文收起，留出恰好能看出「还有下文」的一段 */
const BODY_MAX_HEIGHT = "max-h-80";

/**
 * 底部渐隐：给正文自身加一层掩码，内容向下淡出、露出气泡底色。
 * 用掩码而不是渐变覆盖层——覆盖层要与气泡的 `bg-muted/60` 对色，叠两层半透明色必然有色差。
 */
const BODY_FADE = "mask-b-from-85%";

type UserMessageProps = {
  item: ChatItem;
  /** 本条消息要渲染的内容块（通常就是整条消息的） */
  blocks: MessageBlock[];
  /** 从该条消息分叉；只有主对话传入，子智能体嵌套视图不提供 */
  onFork?: (item: ChatItem) => void;
  /** 编辑该条用户消息并重发；引用与附件一并回传，成功后由事件刷新，返回是否已受理 */
  onEdit?: (item: ChatItem, payload: EditMessagePayload) => Promise<boolean>;
  /** 是否为本会话最后一条用户消息；非最后一条会提示其后内容将被移除 */
  isLastUser?: boolean;
};

/** 正文里的引用：点开右侧工作台预览；没有工作台（子会话嵌套视图、测试）时退化成原文 */
function ContextChip({ path }: { path: string }) {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const label = contextMarker(path);
  if (!workbench) return <span className="font-mono">{label}</span>;
  return (
    <button
      type="button"
      className={`${CHIP_CLASS} font-mono hover:text-foreground`}
      title={t("预览 {{path}}", { path })}
      onClick={() => workbench.openPreview(resolveFromCwd(workbench.cwd, path))}
    >
      {label}
    </button>
  );
}

/**
 * 编辑重发的载荷：正文 + 正文里仍留着的引用 + 原消息带过的附件。
 * 附件来自两处——非图片附件的引用行与图片块，都只需要 id（引用按内容寻址，重建不需要其余信息）。
 */
const editPayloadOf = (
  parsed: ParsedUserMessage,
  text: string,
  blocks: readonly MessageBlock[],
): EditMessagePayload => {
  const contexts = contextRefsOf(parsed, text);
  const ids = [
    ...blocks.filter((block) => block.type === "image").map((block) => block.id),
    ...parsed.attachments.map((attachment) => attachment.id),
  ];
  const attachments = [...new Set(ids)].map((id) => ({ id }));
  return {
    text,
    ...(contexts.length > 0 ? { contexts } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
};

export function UserMessage({ item, blocks, onFork, onEdit, isLastUser }: UserMessageProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const raw = blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
  const parsed = parseUserMessage(raw);
  // 编辑回填与复制都要「用户当初写的那句」，而不是注入进去的模板正文
  const original = userMessageText(parsed);
  const media = blocks.filter((block) => block.type === "image" || block.type === "file");
  const canFork = Boolean(onFork) && !item.live;
  const canEdit = Boolean(onEdit) && !item.live;
  /**
   * 命令被服务端整条换成了模板正文，用户写的东西只剩参数，因此把参数当正文显示；
   * 其余消息正文就是 `@` 引用标记切分后的分段。
   */
  const args = parsed.command?.args ?? "";
  const segments =
    parsed.text.length > 0
      ? parsed.segments
      : args.length > 0
        ? [{ type: "text" as const, text: args }]
        : [];
  const hasChips =
    Boolean(parsed.skill) || Boolean(parsed.command) || parsed.attachments.length > 0;

  /**
   * 溢出只在收起状态下量：展开后高度就是内容高度，`scrollHeight` 与 `clientHeight` 永远相等。
   * 高度上限因此常驻（收起时一直挂着）——先量再决定要不要限高的话，量到的是没受限的高度，永远比不出来。
   */
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const measure = (): void => {
      if (expanded) return;
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    // 栏宽变化会重排正文，行数随之变；虚拟列表已挂 measureElement，高度变化会被重测
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, parsed.text]);

  const startEdit = (): void => {
    setDraft(original);
    setEditing(true);
  };

  const submitEdit = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || !onEdit || saving) return;
    setSaving(true);
    const ok = await onEdit(item, editPayloadOf(parsed, text, blocks));
    setSaving(false);
    if (ok) setEditing(false);
  };

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
            <Button size="sm" disabled={!draft.trim() || saving} onClick={() => void submitEdit()}>
              {t("发送")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1">
      {hasChips ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {parsed.skill ? (
            <span className={CHIP_CLASS} title={t("技能")}>
              <Sparkles className="size-3 shrink-0" />
              {parsed.skill.name}
            </span>
          ) : null}
          {parsed.command ? <span className={CHIP_CLASS}>{`/${parsed.command.name}`}</span> : null}
          {parsed.attachments.map((attachment, index) => (
            <AttachmentLink
              // biome-ignore lint/suspicious/noArrayIndexKey: 同一文件可被引用多次，位置即身份
              key={`${item.id}-att-${index}`}
              id={attachment.id}
              name={attachment.name}
              withIcon
              className={CHIP_CLASS}
            />
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

      {segments.length > 0 ? (
        <div className="max-w-full rounded-lg rounded-br-sm border border-border bg-muted/60">
          <div
            ref={bodyRef}
            className={cn(
              "px-3 py-2 text-sm whitespace-pre-wrap text-foreground",
              // 限高常驻（展开才去）：底部渐隐靠自身掩码，不会碰到气泡的底色与描边
              expanded ? undefined : `${BODY_MAX_HEIGHT} overflow-hidden`,
              expanded || !overflowing ? undefined : BODY_FADE,
            )}
          >
            {segments.map((segment, index) =>
              segment.type === "text" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 分段由文本顺序决定，没有自然 id
                <span key={`${item.id}-seg-${index}`}>{segment.text}</span>
              ) : (
                <ContextChip
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同上，位置即身份
                  key={`${item.id}-seg-${index}`}
                  path={segment.path}
                />
              ),
            )}
          </div>
        </div>
      ) : null}

      {overflowing ? (
        <button
          type="button"
          className="rounded text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? t("收起") : t("展开")}
        </button>
      ) : null}

      <div className="flex min-h-6 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <span className="text-xs text-muted-foreground">{clockLabel(item.createdAt)}</span>
        {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
        {canEdit ? <EditAction onClick={startEdit} /> : null}
        <CopyAction text={original} />
      </div>
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
