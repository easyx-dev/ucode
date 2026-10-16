/**
 * 对话区左侧的用户消息目录条：一条用户消息一格刻度，点它把视口落到那一条。
 *
 * 少于两条用户消息就没有目录可言，整块不渲染。刻度按固定间距自上而下排成一条紧凑的刻度条，
 * 不撑满对话区高度：间距与消息数无关，会话再长也不会稀稀拉拉；装不下时整列等比收缩。
 * 刻度条贴在对话区左侧（偏移取 header 的 `px-4`），内容列两侧留白不够就整块收掉——挤到内容上不如不给。
 * 它压在这里就挡住了左边缘那一条的滚轮：刻度条是滚动容器的兄弟，浏览器不会把滚轮转交给那个容器，
 * 落在刻度上的滚动量由调用方转交（`onWheelScroll`）。
 * 预览只在 tooltip 打开时解析——Radix 挂载内容才渲染，长会话里不为每条消息白付解析开销。
 */

import { parseEntryText, userMessageText } from "@ucode/markdown";
import { cn } from "cn";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../base/tooltip";
import type { MessageBlock } from "../../../types";

/** 预览的长度上限：够认出是哪一句，又不至于把浮层撑成一段正文 */
const PREVIEW_MAX_LENGTH = 80;

/** 常态刻度的长度倍率（`w-4` 的 50% = 8px） */
const BASE_SCALE = 0.5;
/** 悬停那格的倍率（16px 的 150% = 24px），也是级联的上限 */
const HOVER_SCALE = 1.5;
/** 邻居每远一格递减多少：四格之外回到常态 */
const HOVER_FALLOFF = 0.25;

/** 行模式滚动量的一行折合多少像素：Firefox 的滚轮报的是行数，按原值转交几乎不动 */
const WHEEL_LINE_HEIGHT = 16;

/** 滚轮事件 → 纵向滚动量：行模式（Firefox 的滚轮）折成像素，像素模式原样 */
const toWheelDelta = (event: { deltaMode: number; deltaY: number }): number =>
  event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * WHEEL_LINE_HEIGHT : event.deltaY;

/** 悬停时的长度倍率：悬停那格最长，两侧按距离递减——邻居也拉长，但都比悬停那格短 */
const hoverScale = (distance: number): number =>
  Math.max(BASE_SCALE, HOVER_SCALE - HOVER_FALLOFF * distance);

/** 目录条的一格：一条用户消息 */
export type OutlineEntry = {
  /** 它在扁平行里的下标，跳转交给虚拟列表 */
  index: number;
  /** 行 key，只做 React key（跨流式增量稳定） */
  key: string;
  /** 该条消息的内容块：预览按需在其中取 */
  blocks: MessageBlock[];
};

type MessageOutlineProps = {
  entries: OutlineEntry[];
  /** 正在读的那一条（行下标）；没有时为 undefined */
  activeIndex?: number;
  /** 点刻度：把视口落到这一条所在的排 */
  onJump: (index: number) => void;
  /** 滚轮落在刻度条上时的纵向滚动量，由调用方转交给消息区（见文件头） */
  onWheelScroll: (delta: number) => void;
};

export function MessageOutline({
  entries,
  activeIndex,
  onJump,
  onWheelScroll,
}: MessageOutlineProps) {
  const { t } = useTranslation();
  /** 悬停在哪一格：刻度按「与它的距离」级联拉长，所以这个位置得进状态 */
  const [hovered, setHovered] = useState<number | null>(null);
  if (entries.length < 2) return null;

  return (
    <TooltipProvider>
      {/* 内容列两侧的留白不足 24px（内容列铺满面板）就整块收掉：刻度条自己占 16px，还得给内容留点间隙 */}
      <nav
        aria-label={t("用户消息目录")}
        className="pointer-events-none absolute inset-0 hidden @[59rem]:block"
        onWheel={(event) => onWheelScroll(toWheelDelta(event))}
      >
        {/* 左偏移取对话 header 的 `px-4`：贴对话区左侧而不是贴内容列，与内容之间留出留白 */}
        <div
          className="absolute inset-y-4 left-4 flex w-4 flex-col justify-center"
          // 离开整列才收：格与格之间移动不打断级联动画
          onPointerLeave={() => setHovered(null)}
        >
          {entries.map((entry, position) => {
            const active = entry.index === activeIndex;
            const distance = hovered === null ? null : Math.abs(position - hovered);
            const scaleX = distance === null ? BASE_SCALE : hoverScale(distance);
            const scaleY = distance === 0 ? HOVER_SCALE : 1;
            return (
              <Tooltip key={entry.key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    // 刻度本身只有一个点大，报「第几条」比报正文更适合读屏
                    aria-label={t("跳到第 {{index}} 条用户消息", { index: position + 1 })}
                    aria-current={active}
                    onClick={() => onJump(entry.index)}
                    onPointerEnter={() => setHovered(position)}
                    className="group/tick pointer-events-auto flex h-3 min-h-0 shrink items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span
                      className={cn(
                        // 长度在行内算（看与悬停格的距离），变色与变粗交给悬停态自己
                        "block h-0.5 w-4 origin-left rounded-full transition-[background-color,scale] duration-150 ease-out group-hover/tick:bg-foreground",
                        active ? "bg-foreground-subtle" : "bg-foreground/20",
                      )}
                      style={{ scale: `${scaleX} ${scaleY}` }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <OutlinePreview blocks={entry.blocks} />
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    </TooltipProvider>
  );
}

/**
 * 浮层里的预览：正文（剥掉注入的技能 / 命令 / 引用块与只给模型看的位置标记）压成一行；
 * 只有图片或附件的消息没有正文，换成它们的名字——预览总得指出这是哪一条。
 */
function OutlinePreview({ blocks }: { blocks: MessageBlock[] }) {
  const { t } = useTranslation();
  const parsed = parseEntryText(
    blocks.map((block) => (block.type === "text" ? block.text : "")).join(""),
  );
  const text = userMessageText(parsed).replace(/\s+/g, " ").trim();
  if (text.length > 0) {
    return <>{text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text}</>;
  }

  const labels: string[] = [];
  let ordinal = 0;
  for (const block of blocks) {
    if (block.type === "image") {
      ordinal += 1;
      labels.push(t("图片{{index}}", { index: ordinal }));
    } else if (block.type === "file") {
      labels.push(block.name || block.id);
    }
  }
  return <>{labels.length > 0 ? labels.join(" ") : t("（无内容）")}</>;
}
