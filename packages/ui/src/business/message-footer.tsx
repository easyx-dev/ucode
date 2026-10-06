/**
 * 一轮回复的页脚：模型 / 推理档位 / 完成时间 / 耗时，右侧悬停出现分叉入口。
 * 内容段与「以工具调用收尾」的工具分组共用同一份渲染，保证每轮只出现一次。
 */
import { GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import { thinkingLevelLabel } from "../lib/thinking";
import { clockLabel, durationLabel } from "../lib/time";
import type { ChatItem } from "../lib/types";

/** 一条消息悬停时出现的分叉入口：从该条消息抽出新会话 */
export function ForkAction({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="shrink-0 self-center rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground"
      title={t("从此分叉")}
      onClick={onClick}
    >
      <GitFork className="size-3.5" />
    </button>
  );
}

type MessageFooterProps = {
  item: ChatItem;
  /** 本轮回复的总耗时（毫秒） */
  durationMs?: number;
  /** 从该条消息分叉；缺少时不显示入口 */
  onFork?: (item: ChatItem) => void;
};

export function MessageFooter({ item, durationMs, onFork }: MessageFooterProps) {
  const { t } = useTranslation();
  // 页脚描述的是生成这条回复的模型；没有模型信息（非 assistant）时不渲染
  if (!item.model) return null;
  const canFork = Boolean(onFork) && !item.live;

  return (
    <div className="group flex items-center gap-1">
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        {[
          item.provider ? `${item.provider}/${item.model}` : item.model,
          // 「关闭」不代表推理，无展示价值；只在真的启用了推理时补上档位
          item.thinkingLevel && item.thinkingLevel !== "off"
            ? thinkingLevelLabel(item.thinkingLevel, t)
            : "",
          clockLabel(item.completedAt ?? item.createdAt),
          durationMs !== undefined ? t("耗时 {{value}}", { value: durationLabel(durationMs) }) : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
    </div>
  );
}
