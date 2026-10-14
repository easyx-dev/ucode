/**
 * 消息的操作行：悬停才出现的分叉 / 复制入口与元信息，常驻占位以免出现 / 消失时把内容顶动。
 * assistant 段只展示模型与耗时，完整的 provider / 档位 / 时刻放在 `title` 里；内容段与聚合行共用，
 * 保证每轮只出现一次。要不要渲染由行的 `footer` 决定（生成中的那一轮在投影层就把页脚去掉了）。
 * 模型与供应商都按目录里的显示名展示（见 `utils/model`），目录里查不到才回落原 ID。
 */
import { GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CopyAction } from "../../../base/copy-action";
import { useModelNames } from "../../../hooks/store/use-model-names";
import type { ChatItem } from "../../../types";
import { modelRefText } from "../../../utils/model";
import { thinkingLevelLabel } from "../../../utils/thinking";
import { clockLabel, durationLabel } from "../../../utils/time";

/** 一条消息悬停时出现的分叉入口：从该条消息抽出新会话 */
export function ForkAction({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="shrink-0 rounded-xs p-1 text-foreground-subtle hover:bg-state-hover hover:text-foreground"
      title={t("从此分叉")}
      onClick={onClick}
    >
      <GitFork className="size-icon-sm" />
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
  const names = useModelNames();
  // 页脚描述的是生成这条回复的模型；没有模型信息（非 assistant）时不渲染
  if (!item.model) return null;
  const canFork = Boolean(onFork);
  const answer = answerTextOf(item);
  const duration = durationMs !== undefined ? durationLabel(durationMs) : "";
  const modelLabel = names.modelName(item.provider, item.model);
  const full = [
    item.provider ? modelRefText(names.providerName(item.provider), modelLabel) : modelLabel,
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
      <span className="min-w-0 flex-1 truncate text-xs text-foreground-subtle" title={full}>
        {[modelLabel, duration].filter(Boolean).join(" · ")}
      </span>
      {answer ? <CopyAction text={answer} /> : null}
      {canFork ? <ForkAction onClick={() => onFork?.(item)} /> : null}
    </div>
  );
}
