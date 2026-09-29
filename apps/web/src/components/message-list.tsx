import { useEffect, useRef } from "react";

import { MessageItem } from "@/components/message-item";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatItem } from "@/lib/types";

type MessageListProps = {
  items: ChatItem[];
  loading?: boolean;
  /** 已发送、首个生成内容未到：尾部显示等待指示 */
  pending?: boolean;
  empty?: React.ReactNode;
};

export function MessageList({ items, loading, pending, empty }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

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

        {items.map((item) => (
          <MessageItem key={item.id} item={item} />
        ))}

        {pending ? <ThinkingIndicator /> : null}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
