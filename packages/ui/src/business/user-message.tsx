/**
 * 用户消息：句子里的引用 chip 与图片 / 附件 token + 句子外的技能与命令 chip + 气泡与底部操作行。
 *
 * 引用、图片与附件是句子成分，因此在用户写的那句里就地渲染（引用点开右侧工作台预览，
 * 图片开弹层看原图，附件下载），位置就是用户当初放的位置；技能与命令不属于任何句子，排在气泡上方。
 * 时刻与操作（分叉 / 编辑 / 复制）落在气泡下方，常驻占位、悬停才现，出现时不顶动内容。
 *
 * 气泡走反色面：浅色深底白字、深色浅底深字，让它直接铺在面板底上的 assistant 正文一眼分得开。
 * 句子成分因此落在反色底上，各自带底色的引用 chip 与附件 token 都留着原来的取法（它们本来就有面）。
 *
 * 正文超过一段高度就折叠（底部渐隐 + 展开入口）：用户贴整段日志时不该把屏幕占满。
 * 编辑态复用输入区的编辑器（见 `message-edit-form`），改写后重发，旧分支留在会话文件里。
 */

import { cn } from "cn";
import { Pencil, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAttachmentUrl } from "../hooks/use-attachment-url";
import { contextMarker, parseUserMessage, userMessageText } from "../lib/message-chips";
import { resolveFromCwd } from "../lib/path";
import { clockLabel } from "../lib/time";
import type { ChatItem, EditMessagePayload, MessageBlock } from "../lib/types";
import { useWorkbench } from "../provider/workbench";
import { AttachmentToken } from "./attachment-token";
import { CopyAction } from "./copy-action";
import { openImagePreview } from "./image-preview-dialog";
import { MessageEditForm } from "./message-edit-form";
import { ForkAction } from "./message-footer";

/** chip 共用一套外观：句子外的技能 / 命令与句子里的引用都长这样 */
const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-xs bg-muted px-2 py-0.5 text-xs text-foreground-subtle";

/** 折叠阈值：超过这个高度的正文收起，留出恰好能看出「还有下文」的一段 */
const BODY_MAX_HEIGHT = "max-h-80";

/**
 * 底部渐隐：给正文自身加一层掩码，内容向下淡出、露出气泡底色。
 * 用掩码而不是渐变覆盖层——覆盖层要与气泡底色对色，叠两层半透明色必然有色差。
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
  /** 从目录条跳过来时闪一下，好认出落点是哪一条（时长由列表管） */
  highlight?: boolean;
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
      onClick={() => workbench.openFile(resolveFromCwd(workbench.cwd, path))}
    >
      {label}
    </button>
  );
}

/** 正文里的图片：token 点击开弹层看原图，与编辑器里的图片 token 共用预览 */
function InlineImage({ id, index }: { id: string; index: number }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="mx-0.5 align-baseline"
      title={t("图片预览")}
      onClick={() => openImagePreview({ source: id })}
    >
      <AttachmentToken kind="image" index={index} />
    </button>
  );
}

/**
 * 正文里的附件：token 形态的下载入口。字节取不回来时先淡出、失败再加划线，
 * 与 assistant 侧的文件块同一姿态——不让附件凭空消失。
 */
function AttachmentTokenLink({ id, name }: { id: string; name?: string | null }) {
  const { t } = useTranslation();
  const { url: source, failed } = useAttachmentUrl(id);
  const label = name || id;
  if (!source) {
    return (
      <span
        className={failed ? "line-through opacity-60" : "opacity-60"}
        title={failed ? t("附件不可用") : label}
      >
        <AttachmentToken kind="file" name={label} />
      </span>
    );
  }
  return (
    <a href={source} download={label} title={label} className="group inline-block">
      <AttachmentToken kind="file" name={label} className="group-hover:text-foreground" />
    </a>
  );
}

export function UserMessage({
  item,
  blocks,
  onFork,
  onEdit,
  isLastUser,
  highlight,
}: UserMessageProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const canFork = Boolean(onFork) && !item.live;
  const canEdit = Boolean(onEdit) && !item.live;

  const raw = blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
  const parsed = parseUserMessage(raw);
  // 编辑回填与复制都要「用户当初写的那句」，而不是注入进去的模板正文
  const original = userMessageText(parsed);
  /**
   * 命令被服务端整条换成了模板正文，用户写的东西只剩参数，因此把参数当正文显示；
   * 其余消息正文就是各类标记切分后的分段（只有附件的消息分段非空、正文为空）。
   */
  const args = parsed.command?.args ?? "";
  const segments =
    parsed.segments.length > 0
      ? parsed.segments
      : args.length > 0
        ? [{ type: "text" as const, text: args }]
        : [];
  const hasChips = Boolean(parsed.skill) || Boolean(parsed.command);

  /** 图片块按出现顺序：正文里的 `图片 N` 就是这个次序里的第 N 张 */
  const imageBlocks = blocks.filter(
    (block): block is Extract<MessageBlock, { type: "image" }> => block.type === "image",
  );
  const inlineImages = new Set(
    segments.filter((segment) => segment.type === "image").map((segment) => segment.index),
  );
  /** 媒体行只兜底正文里没有标记的图片（早期消息）与文件块 */
  const mediaBlocks = blocks.filter(
    (block): block is Extract<MessageBlock, { type: "image" | "file" }> => {
      if (block.type === "file") return true;
      if (block.type !== "image") return false;
      return !inlineImages.has(imageBlocks.indexOf(block) + 1);
    },
  );

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
  }, [expanded, raw]);

  if (editing && onEdit) {
    return (
      <MessageEditForm
        item={item}
        parsed={parsed}
        images={imageBlocks.map((block) => block.id)}
        warning={isLastUser === false}
        onEdit={onEdit}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="group ml-auto flex w-fit max-w-[85%] flex-col items-end gap-1">
      {hasChips ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {parsed.skill ? (
            <span className={CHIP_CLASS} title={t("技能")}>
              <Sparkles className="size-icon-xs shrink-0" />
              {parsed.skill.name}
            </span>
          ) : null}
          {parsed.command ? <span className={CHIP_CLASS}>{`/${parsed.command.name}`}</span> : null}
        </div>
      ) : null}

      {mediaBlocks.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-2">
          {mediaBlocks.map((block, index) =>
            block.type === "image" ? (
              <InlineImage
                // biome-ignore lint/suspicious/noArrayIndexKey: 附件块按顺序排列，位置即身份
                key={`${item.id}-media-${index}`}
                id={block.id}
                index={imageBlocks.indexOf(block) + 1}
              />
            ) : (
              <AttachmentTokenLink
                // biome-ignore lint/suspicious/noArrayIndexKey: 同上，位置即身份
                key={`${item.id}-media-${index}`}
                id={block.id}
                name={block.name}
              />
            ),
          )}
        </div>
      ) : null}

      {segments.length > 0 ? (
        <div
          className={cn(
            // 反色面（与浮层同一对 token）：浅色近黑底白字、深色近白底深字；右下收一档，读起来像说话的一角
            "max-w-full rounded-lg rounded-br-xs bg-foreground text-background",
            highlight && "ring-2 ring-ring/50",
          )}
        >
          <div
            ref={bodyRef}
            className={cn(
              "px-3 py-2 text-sm break-words whitespace-pre-wrap",
              // 限高常驻（展开才去）：底部渐隐靠自身掩码，不会碰到气泡的底色
              expanded ? undefined : `${BODY_MAX_HEIGHT} overflow-hidden`,
              expanded || !overflowing ? undefined : BODY_FADE,
            )}
          >
            {segments.map((segment, index) =>
              segment.type === "text" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: 分段由文本顺序决定，没有自然 id
                <span key={`${item.id}-seg-${index}`}>{segment.text}</span>
              ) : segment.type === "context" ? (
                <ContextChip
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同上，位置即身份
                  key={`${item.id}-seg-${index}`}
                  path={segment.path}
                />
              ) : segment.type === "attachment" ? (
                <AttachmentTokenLink
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同上，位置即身份
                  key={`${item.id}-seg-${index}`}
                  id={segment.id}
                  name={segment.name}
                />
              ) : imageBlocks[segment.index - 1] ? (
                <InlineImage
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同上，位置即身份
                  key={`${item.id}-seg-${index}`}
                  id={imageBlocks[segment.index - 1]?.id ?? ""}
                  index={segment.index}
                />
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      {overflowing ? (
        <button
          type="button"
          className="rounded-xs text-xs text-foreground-subtle hover:text-foreground"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? t("收起") : t("展开")}
        </button>
      ) : null}

      <div className="flex min-h-6 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <span className="text-xs text-foreground-subtle">{clockLabel(item.createdAt)}</span>
        {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
        {canEdit ? <EditAction onClick={() => setEditing(true)} /> : null}
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
      className="shrink-0 rounded-xs p-1 text-foreground-subtle hover:bg-state-hover hover:text-foreground"
      title={t("编辑并重新发送")}
      onClick={onClick}
    >
      <Pencil className="size-icon-sm" />
    </button>
  );
}
