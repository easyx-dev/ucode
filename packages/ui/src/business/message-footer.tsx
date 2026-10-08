/**
 * 消息的操作行：悬停才出现的分叉 / 复制入口与元信息，常驻占位以免出现 / 消失时把内容顶动。
 * assistant 段只展示模型与耗时，完整的 provider / 档位 / 时刻放在 `title` 里；内容段与聚合行共用，
 * 保证每轮只出现一次。要不要渲染由行的 `footer` 决定（生成中的那一轮在投影层就把页脚去掉了）。
 */
import { Check, Copy, GitFork } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../lib/clipboard";
import { thinkingLevelLabel } from "../lib/thinking";
import { clockLabel, durationLabel } from "../lib/time";
import type { ChatItem } from "../lib/types";

/** 一条消息悬停时出现的分叉入口：从该条消息抽出新会话 */
export function ForkAction({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      title={t("从此分叉")}
      onClick={onClick}
    >
      <GitFork className="size-3.5" />
    </button>
  );
}

/** 复制成功后的提示时长；够看清换了图标，又不至于一直占着「已复制」 */
const COPIED_HINT_MS = 1500;

/**
 * 复制一条消息的文本：成功后图标换成对勾并保持片刻。
 * 失败（非安全上下文、无权限、剪贴板被别的程序占着）静默保持原状——复制不是关键路径，
 * 为它弹一条错误提示比失败本身更打扰人。兜底走 `lib/clipboard`：两条路都试过。
 */
export function CopyAction({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      title={copied ? t("已复制") : t("复制")}
      onClick={() => {
        void copyText(text).then((ok) => setCopied(ok));
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** assistant 消息的正文：页脚的「复制」只取正文块，思考与工具调用不属于这条回答 */
const answerTextOf = (item: ChatItem): string =>
  item.blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

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
  const canFork = Boolean(onFork);
  const answer = answerTextOf(item);
  const duration = durationMs !== undefined ? durationLabel(durationMs) : "";
  const full = [
    item.provider ? `${item.provider}/${item.model}` : item.model,
    // 「关闭」不代表推理，无展示价值；只在真的启用了推理时补上档位
    item.thinkingLevel && item.thinkingLevel !== "off"
      ? thinkingLevelLabel(item.thinkingLevel, t)
      : "",
    clockLabel(item.completedAt ?? item.createdAt),
    duration ? t("耗时 {{value}}", { value: duration }) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-h-6 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={full}>
        {[item.model, duration].filter(Boolean).join(" · ")}
      </span>
      {answer ? <CopyAction text={answer} /> : null}
      {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
    </div>
  );
}
