/**
 * 对话消息列表：扁平行 + 虚拟滚动。
 *
 * 贴底跟随交给虚拟列表的 end 锚定——视口本来贴着底部时，末尾行流式增高会按高度差补偿继续保持贴底；
 * 用户上翻回看历史后，新内容不会把人拉回去。
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import type { StreamPhase } from "@ucode/sdk";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../../base/skeleton";
import { useShowThinking } from "../../../hooks/use-show-thinking";
import type { ChatItem, EditMessagePayload, SubagentStreams } from "../../../types";
import { SubagentEntry } from "../tool/subagent-entry";
import { subagentSessionIdOf } from "../tool/tool-view";
import type { ToolEntry } from "./chat-nodes";
import {
  buildChatRows,
  type ChatRow,
  compactionKeyOf,
  lastCompactionIndexOf,
  withoutThinking,
} from "./chat-rows";
import { MessageOutline, type OutlineEntry } from "./message-outline";
import { MessageRow } from "./message-row";

/** 首屏尚未测量时的行高估计；实测后由 ResizeObserver 校正，只影响未渲染行的滚动条长度 */
const ESTIMATED_HEIGHT: Record<ChatRow["kind"], number> = {
  content: 120,
  activity: 36,
  change: 52,
  question: 180,
  permission: 72,
  compaction: 44,
  injected: 36,
  goal: 44,
  goalTurn: 44,
  retry: 36,
  working: 32,
};

/** 距底部多少像素内算「贴着底部」；更远就认为用户在回看历史 */
const SCROLL_END_THRESHOLD = 96;

/** 从目录条跳到某条消息后，目标气泡的定位高亮保持多久（与活动面板的高亮同一档） */
const HIGHLIGHT_MS = 1600;

type MessageListProps = {
  items: ChatItem[];
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents?: SubagentStreams;
  loading?: boolean;
  /** 正在进行中：列表尾部显示当前阶段与实时耗时 */
  working?: boolean;
  /** 本轮进行的是上下文压缩：尾部提示改报「正在压缩上下文」 */
  compacting?: boolean;
  /** 模型此刻在做什么：尾部提示据此换文案与计时起点 */
  phase?: StreamPhase | null;
  empty?: React.ReactNode;
  /** 切换会话时变化，用于重置滚动位置与已测量的行高 */
  resetKey?: string;
  /** 发送被受理后自增：即使视口停在历史位置，也要落回最新一行并重新打开跟随 */
  sentTick?: number;
  /** 打开子会话（子智能体工具卡中的入口） */
  onOpenSession?: (sessionId: string) => void;
  /** 打开活动面板并定位到某个子智能体（工具行上的入口） */
  onOpenActivity?: (toolCallId: string) => void;
  /** 从某条消息分叉（仅主对话） */
  onFork?: (item: ChatItem) => void;
  /** 编辑某条用户消息并重发（仅主对话）；返回是否已受理 */
  onEdit?: (item: ChatItem, payload: EditMessagePayload) => Promise<boolean>;
};

export function MessageList({
  items,
  subagents,
  loading,
  working,
  compacting,
  phase,
  empty,
  resetKey,
  sentTick,
  onOpenSession,
  onOpenActivity,
  onFork,
  onEdit,
}: MessageListProps) {
  const { t } = useTranslation();
  const { showThinking } = useShowThinking();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 用户是否贴着底部：为真则新内容继续跟随，为假则只亮出「回到底部」
  // 它只在 scroll 事件里改写——实测高度让 totalSize 变大并不触发 scroll 事件，用距离直接驱动状态会卡住
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  /** 刚跳过去、要闪一下的那一行 key */
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  /** 上一次见过的压缩分隔行：新出现一条时才知道「这次重写带来了压缩」 */
  const lastCompactionKeyRef = useRef<string | null>(null);
  /** 是否已经见过至少一行：hydrate 完成前列表必然为空，那一刻不算「历史」 */
  const hadRowsRef = useRef(false);

  const rows = useMemo(
    () => buildChatRows(showThinking ? items : withoutThinking(items), working),
    [items, working, showThinking],
  );

  /** 目录条要的刻度：每条用户消息一格，带上行下标（跳转）与内容块（预览） */
  const outlineEntries = useMemo<OutlineEntry[]>(
    () =>
      rows.flatMap((row, index) =>
        row.kind === "content" && row.node.item.role === "user"
          ? [{ key: row.key, index, blocks: row.node.blocks }]
          : [],
      ),
    [rows],
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

  // 工具行里的子智能体入口：工具卡默认收起，入口不跟着藏——不展开也看得见它在跑。
  // 它有实时进度记录时点开活动面板并定位到那一条；没有记录的（历史条目）按结果里的 task_id 直接开小窗
  const renderToolTrailing = useCallback(
    (entry: ToolEntry) => {
      const stream = subagents?.[entry.id];
      if (stream && onOpenActivity) {
        return (
          <SubagentEntry
            status={stream.done ? (stream.isError ? "failed" : "done") : "running"}
            description={stream.description}
            onOpen={() => onOpenActivity(entry.id)}
          />
        );
      }
      // 跑完的子智能体仍留在进度清单里（标 done），但断流重取或更早的会话只有结果里的 task_id
      if (stream || !onOpenSession) return null;
      const sessionId = subagentSessionIdOf(entry);
      return sessionId ? (
        <SubagentEntry
          description=""
          label={t("查看子会话")}
          onOpen={() => onOpenSession(sessionId)}
        />
      ) : null;
    },
    [subagents, onOpenActivity, onOpenSession, t],
  );
  const context = useMemo(
    () => ({
      renderToolTrailing,
      ...(compacting ? { compacting } : {}),
      ...(phase ? { phase } : {}),
      ...(onFork ? { onFork } : {}),
      ...(onEdit ? { onEdit } : {}),
      ...(highlightKey ? { highlightKey } : {}),
    }),
    [renderToolTrailing, compacting, phase, onFork, onEdit, highlightKey],
  );

  const setFollowingBoth = useCallback((next: boolean) => {
    followingRef.current = next;
    setFollowing(next);
  }, []);

  // 贴底跟随是自己发起的滚动：它引发的那一个 scroll 事件不能当作用户意图（那一刻的距离可能仍大于
  // 阈值，新行高度刚实测完），否则「回到底部」会凭空亮起来。只豁免这一个事件，用户真的滚动（滚轮 /
  // 触摸 / 拖滚动条）总会另外产生事件，不会被吞掉
  const ownScrollRef = useRef(false);
  const scrollToLatest = useCallback(() => {
    ownScrollRef.current = true;
    virtualizer.scrollToEnd();
  }, [virtualizer]);

  /**
   * 从目录条跳过去：平滑滚到那条消息的顶部，且关掉贴底跟随——不关的话正在流式追加的内容
   * 会在下一次渲染里把视口拽回底部，跳了等于没跳。行 key 从 ref 现取，取的就是当前这份投影里的行。
   *
   * 落点由虚拟列表的测量给出，没渲染过的行只有估算高度，长会话里可能差一两条消息；
   * 真实位置由目录条常亮的那一格反映，不去反复纠偏（再调一次拿到的仍是同一批估算）。
   */
  const jumpToRow = useCallback(
    (index: number) => {
      setFollowingBoth(false);
      virtualizer.scrollToIndex(index, { align: "start", behavior: "smooth" });
      setHighlightKey(rowsRef.current[index]?.key ?? null);
    },
    [setFollowingBoth, virtualizer],
  );

  /**
   * 定位高亮只留一会儿：够看清落点，又不会一直亮着。
   * 滚动期间先不开始计时——平滑滚动到远处要一会儿，等停下来再算，那 1.6s 才落在看得见的时候。
   */
  const scrolling = virtualizer.isScrolling;
  useEffect(() => {
    if (!highlightKey || scrolling) return;
    const timer = setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightKey, scrolling]);

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

  /**
   * 滚轮落在目录条的刻度上时接过来自己滚：刻度条是滚动容器的兄弟，浏览器不会把它的滚轮转交给那个容器，
   * 不接的话指针停在对话区左侧那一条上就滚不动了。
   */
  const handleWheelScroll = (delta: number): void => {
    scrollRef.current?.scrollBy({ top: delta });
  };

  const backToLatest = () => {
    setFollowingBoth(true);
    scrollToLatest();
  };

  // 首次挂载与切换会话都直接落到最新一条，避免先渲染顶部再跳一次
  useLayoutEffect(() => {
    // 重新等第一份历史：hydrate 还没回来时 rows 是空的，那一刻的分隔行不能当成「刚压过」（见下一条）
    hadRowsRef.current = false;
    lastCompactionKeyRef.current = compactionKeyOf(rowsRef.current);
    virtualizer.measure();
    scrollToLatest();
    setFollowingBoth(true);
  }, [virtualizer, resetKey, setFollowingBoth, scrollToLatest]);

  // 发送 / 编辑重发被受理：视口一律落回最新一行并重新打开跟随，
  // 否则上翻看历史后发出的那条只会追加在列表末尾，用户看不到自己刚发的内容。
  // 跳过 0：初值不该与上面的重置重复触发。
  useLayoutEffect(() => {
    if (!sentTick) return;
    setFollowingBoth(true);
    scrollToLatest();
  }, [sentTick, setFollowingBoth, scrollToLatest]);

  // 新出现一条压缩分隔行：把视口落到它，否则压缩完历史一换，用户只会看到内容平白变短。
  // 有压缩记录时行就落在底部（用户正看着它，也在跟随），这种情况不动视口——
  // 滚过去反而会关掉跟随，随后流式生成的回答就看不到了；没有记录的旧数据才需要这一下。
  useLayoutEffect(() => {
    const key = compactionKeyOf(rows);
    // 列表清空时重等历史：切会话或重新 hydrate 都会经过这一步
    if (rows.length === 0) {
      hadRowsRef.current = false;
      lastCompactionKeyRef.current = null;
      return;
    }
    // 首次拿到历史：这一刻的分隔行是既有的，不是刚压出来的。刷新页面与打开一个早就压过的会话都走
    // 这一支——hydrate 回来前 rows 是空的，基线只能是 null，不区分就会被当成「刚压缩」而停在旧压缩点
    if (!hadRowsRef.current) {
      hadRowsRef.current = true;
      lastCompactionKeyRef.current = key;
      return;
    }
    if (key === lastCompactionKeyRef.current) return;
    lastCompactionKeyRef.current = key;
    if (key === null) return;
    const index = lastCompactionIndexOf(rows);
    if (index < 0 || index >= rows.length - 2) return;
    setFollowingBoth(false);
    virtualizer.scrollToIndex(index, { align: "start" });
  }, [rows, setFollowingBoth, virtualizer]);

  // 行数或总高度变化（新行、实测高度落定）时，只要用户没往上翻就跟到最新
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

  /**
   * 目录条常亮的那一条：视口顶端那一行之前（含）的最后一条用户消息。
   * 取 `getVirtualItemForOffset` 而不是第一个虚拟项——后者含 overscan，会比视口顶多出好几行。
   */
  const topRowIndex =
    virtualizer.getVirtualItemForOffset(virtualizer.scrollOffset ?? 0)?.index ?? 0;
  const activeOutlineIndex = outlineEntries.reduce<number | undefined>(
    (active, entry) => (entry.index <= topRowIndex ? entry.index : active),
    undefined,
  );

  return (
    // `@container`：目录条（message-outline）只看这一块的宽度——分栏可拖、面板宽度与窗口宽度不是一回事
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
        onScroll={handleScroll}
      >
        {rows.length === 0 ? (
          <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-6">
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
            className="relative mx-auto w-full max-w-4xl"
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

      <MessageOutline
        entries={outlineEntries}
        activeIndex={activeOutlineIndex}
        onJump={jumpToRow}
        onWheelScroll={handleWheelScroll}
      />

      {following || rows.length === 0 ? null : (
        <button
          type="button"
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-popover px-3 py-1 text-xs text-foreground ring-1 ring-border-strong hover:bg-state-hover"
          onClick={backToLatest}
        >
          <ArrowDown className="size-icon-sm" />
          {t("回到底部")}
        </button>
      )}
    </div>
  );
}
