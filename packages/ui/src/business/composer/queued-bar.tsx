/**
 * 「排队中」条带：生成中发出去、还没轮到送出的输入。
 *
 * 它是输入卡的上沿一条（与目标栏同一层）：本轮结束后这些输入会依次进入对话，
 * 在那之前它们没有会话条目，只能由这条带子表达。撤回是整条一起撤（pi 的队列只能整清），
 * 所以只有「本端记全了服务端队列里那几条」时才给这个入口。
 */
import { CornerDownRight, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import type { QueuedPrompt } from "./queued-prompt";

type QueuedBarProps = {
  /** 本端记着的排队条目（发出时的载荷摘要） */
  items: QueuedPrompt[];
  /** 服务端还有、本端记不住的条数（页面刷新前排队的那几条，内容取不回来） */
  extra: number;
  /** 撤回全部并回填输入区；`undefined` 表示现在不给撤（队列里有本端还不了的内容） */
  onWithdraw?: () => void;
  /**
   * 当前这一轮是否还在跑：中断之后队列里可能还留着几条（会在下一轮收尾时送出），
   * 那时的说明不能再说「本轮结束后」。
   */
  streaming: boolean;
};

export function QueuedBar({ items, extra, onWithdraw, streaming }: QueuedBarProps) {
  const { t } = useTranslation();
  const total = items.length + extra;
  if (total === 0) return null;

  return (
    <div className="rounded-t-lg border-b border-border bg-muted/50 px-3 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <CornerDownRight aria-hidden className="size-icon-base shrink-0 text-foreground-subtle" />
        <span className="shrink-0 font-medium text-foreground">{t("排队中")}</span>
        <span className="shrink-0 tabular-nums text-foreground-subtle">
          {t("{{count}} 条", { count: total })}
        </span>
        <span className="min-w-0 truncate text-foreground-subtle">
          {streaming ? t("本轮结束后依次送出") : t("下一轮结束时依次送出")}
        </span>
        {onWithdraw ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto shrink-0 text-foreground-subtle hover:text-destructive"
            onClick={onWithdraw}
          >
            <Undo2 className="size-icon-xs" />
            {t("撤回")}
          </Button>
        ) : null}
      </div>
      {items.length > 0 || extra > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="truncate pl-6 text-xs text-foreground-subtle"
              title={item.label}
            >
              {item.label}
            </li>
          ))}
          {extra > 0 ? (
            <li className="pl-6 text-xs text-foreground-subtlest">
              {t("另有 {{count}} 条（刷新前发出的，取不回内容）", { count: extra })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
