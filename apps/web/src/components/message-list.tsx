import { useEffect, useRef } from "react";

import { MessageItem } from "@/components/message-item";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatItem, SubagentStreams } from "@/lib/types";

type MessageListProps = {
  items: ChatItem[];
  /** 进行中的子智能体进度，按父会话里的 toolCallId 索引 */
  subagents?: SubagentStreams;
  loading?: boolean;
  /** 已发送、首个生成内容未到：尾部显示等待指示 */
  pending?: boolean;
  empty?: React.ReactNode;
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
  pending,
  empty,
  onOpenSession,
  onFork,
  onEdit,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // 最后一条用户消息之后的内容会在编辑重发时被移除，据此给出提示
  let lastUserIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  useEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
    // pending 出现 / 消失也要贴底
  }, [items, pending]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    pinnedRef.current = distance < 120;
  };

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
        {loading && items.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
            <Skeleton className="h-20 w-3/4" />
          </div>
        ) : null}

        {!loading && items.length === 0 ? empty : null}

        {items.map((item, index) => (
          <MessageItem
            // 工具项在 `message_end` 合并时 id 会从 `live-tool-*` 换成服务端 id；
            // 用 toolCallId 作 key，避免重挂导致展开的嵌套进度被收起
            key={item.role === "tool" && item.toolCallId ? `tool-${item.toolCallId}` : item.id}
            item={item}
            subagent={item.toolCallId ? subagents?.[item.toolCallId] : undefined}
            onOpenSession={onOpenSession}
            onFork={onFork}
            onEdit={onEdit}
            isLastUser={index === lastUserIndex}
          />
        ))}

        {pending ? <ThinkingIndicator /> : null}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
