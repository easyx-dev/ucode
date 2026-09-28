import type { ReactNode } from "react";
import { PlusIcon } from "./icons.tsx";

/**
 * 空会话的问候语。
 *
 * 对齐 ZCode 的 `ConversationDraftEmptyState`：按时段给一句问候，
 * 而不是一句干巴巴的"还没有消息"——用户打开界面第一眼看到的东西，
 * 决定他知不知道接下来能做什么。
 */
export function greetingFor(hour: number): string {
  if (hour < 5) return "夜深啦，别忘了照顾好自己哦";
  if (hour < 9) return "早上好呀，新的一天开始啦";
  if (hour < 12) return "上午好呀，有什么想让我帮忙的吗";
  if (hour < 14) return "中午好呀，要不要先休息一下";
  if (hour < 18) return "下午好呀，接下来交给我吧";
  return "晚上好呀，今天辛苦啦";
}

export function EmptyState({
  onCreate,
  productName,
}: {
  onCreate: () => void;
  productName: string;
}): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
      <p className="text-base text-[var(--color-content)]">{greetingFor(new Date().getHours())}</p>
      <p className="max-w-md text-center text-xs text-[var(--color-content-faint)]">
        向 {productName} 提问，输入 / 选择命令或能力。
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent-foreground)] transition-colors hover:bg-[var(--color-accent-hover)]"
      >
        <PlusIcon className="size-3.5" />
        新建会话
      </button>
    </div>
  );
}
