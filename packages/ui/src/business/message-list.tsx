/**
 * 对话消息列表：扁平行 + 虚拟滚动。
 *
 * 贴底跟随交给虚拟列表的 end 锚定——视口本来贴着底部时，末尾行流式增高会按高度差补偿继续保持贴底；
 * 用户上翻回看历史后，新内容不会把人拉回去。
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../base/skeleton";
import { useShowThinking } from "../hooks/use-show-thinking";
import type { ToolEntry } from "../lib/chat-nodes";
import { buildChatRows, type ChatRow, withoutThinking } from "../lib/chat-rows";
import type { ChatItem, SubagentStreams } from "../lib/types";
import { MessageRow, type MessageRowContext } from "./message-row";
import { SubagentProgress } from "./subagent-progress";

/** 首屏尚未测量时的行高估计；实测后由 ResizeObserver 校正，只影响未渲染行的滚动条长度 */
const ESTIMATED_HEIGHT: Record<ChatRow["kind"], number> = {
  content: 120,
  activity: 36,
  question: 180,
  permission: 72,
  working: 32,
};

/** 距底部多少像素内算「贴着底部」；更远就认为用户在回看历史 */
const SCROLL_END_THRESHOLD = 96;

type MessageListProps = {
  items: ChatItem[];
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents?: SubagentStreams;
  loading?: boolean;
  /** 正在进行中：列表尾部显示「工作中」与实时耗时 */
  working?: boolean;
  empty?: React.ReactNode;
  /** 切换会话时变化，用于重置滚动位置与已测量的行高 */
  resetKey?: string;
  /** 打开子会话（子智能体工具卡中的入口） */
  onOpenSession?: (sessionId: string) => void;
  /** 从某条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话）；返回是否已受理 */
  onEdit?: (item: ChatItem, text: string) => Promise<boolean>;
};

export function MessageList({
  items,
  subagents,
  loading,
  working,
  empty,
  resetKey,
  onOpenSession,
  onFork,
  onEdit,
}: MessageListProps) {
  const { t } = useTranslation();
  const { showThinking } = useShowThinking();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 用户是否贴着底部：为真则新内容继续跟随，为假则只亮出「回到底部」。
  // 它只在 scroll 事件里改写——实测高度让 totalSize 变大并不触发 scroll 事件，用距离直接驱动状态会卡住
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);

  const rows = useMemo(
    () => buildChatRows(showThinking ? items : withoutThinking(items), working),
    [items, working, showThinking],
  );

  // 虚拟列表的回调必须保持引用稳定，否则每次增量都会作废已测量的行高；行数据经 ref 读最新值
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const getItemKey = useCallback((index: number) => rowsRef.current[index]?.key ?? index, []);
  const estimateSize = useCallback(
    (index: number) => ESTIMATED_HEIGHT[rowsRef.current[index]?.kind ?? "content"],
    [],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: SCROLL_END_THRESHOLD,
    overscan: 6,
    paddingStart: 16,
    paddingEnd: 32,
  });

  const renderExtra = useCallback(
    (entry: ToolEntry) => {
      const stream = subagents?.[entry.id];
      return stream ? <SubagentProgress stream={stream} onOpenSession={onOpenSession} /> : null;
    },
    [subagents, onOpenSession],
  );
  const context = useMemo(
    () => ({ renderExtra, ...(onFork ? { onFork } : {}), ...(onEdit ? { onEdit } : {}) }),
    [renderExtra, onFork, onEdit],
  );

  const setFollowingBoth = useCallback((next: boolean) => {
    followingRef.current = next;
    setFollowing(next);
  }, []);

  // 贴底跟随是自己发起的滚动：它引发的那一个 scroll 事件不能当作用户意图（那一刻的距离可能仍大于
  // 阈值，新行高度刚实测完），否则「回到底部」会凭空亮起来。只豁免这一个事件，用户真的滚动（滚轮 /
  // 触摸 / 拖滚动条）总会另外产生事件，不会被吞掉。
  const ownScrollRef = useRef(false);
  const scrollToLatest = useCallback(() => {
    ownScrollRef.current = true;
    virtualizer.scrollToEnd();
  }, [virtualizer]);

  const handleScroll = () => {
    const atEnd = virtualizer.isAtEnd(SCROLL_END_THRESHOLD);
    if (ownScrollRef.current) {
      ownScrollRef.current = false;
      // 自己这次滚动只能确认贴底，不能把用户「贴在底部」的状态降级
      if (atEnd) setFollowingBoth(true);
      return;
    }
    setFollowingBoth(atEnd);
  };

  const backToLatest = () => {
    setFollowingBoth(true);
    scrollToLatest();
  };

  // 首次挂载与切换会话都直接落到最新一条，避免先渲染顶部再跳一次
  useLayoutEffect(() => {
    virtualizer.measure();
    scrollToLatest();
    setFollowingBoth(true);
  }, [virtualizer, resetKey, setFollowingBoth, scrollToLatest]);

  // 行数或总高度变化（新行、实测高度落定）时，只要用户没往上翻就跟到最新。
  // 总高度也要看：只盯行数会在实测修正后停在中途，看上去像没贴底
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (!followingRef.current) return;
    scrollToLatest();
    const frame = requestAnimationFrame(() => {
      if (followingRef.current) scrollToLatest();
    });
    return () => cancelAnimationFrame(frame);
  }, [rows.length, totalSize, scrollToLatest]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
        onScroll={handleScroll}
      >
        {rows.length === 0 ? (
          <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6">
            {loading ? (
              <>
                <Skeleton className="h-12 w-2/3" />
                <Skeleton className="ml-auto h-12 w-1/2" />
                <Skeleton className="h-20 w-3/4" />
              </>
            ) : (
              empty
            )}
          </div>
        ) : (
          <div
            className="relative mx-auto w-full max-w-3xl"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return row ? (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <MessageRow row={row} context={context} />
                </div>
              ) : null;
            })}
          </div>
        )}
      </div>

      {following || rows.length === 0 ? null : (
        <button
          type="button"
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-popover px-3 py-1 text-xs text-foreground ring-1 ring-foreground/10 hover:bg-muted"
          onClick={backToLatest}
        >
          <ArrowDown className="size-3.5" />
          {t("回到底部")}
        </button>
      )}
    </div>
  );
}
