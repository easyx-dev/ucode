/**
 * 工具行上的子智能体短入口：工具卡默认收起，入口不跟着藏——不展开也能看见它在跑，
 * 点它打开活动面板并定位到这一条。
 *
 * 实时过程已经搬到面板里（原来的内联进度整块撤掉），这里只留状态与去向。
 */
import type { TFunction } from "i18next";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ActivitySubagentStatus } from "../lib/session-activity";

const statusText = (status: ActivitySubagentStatus, t: TFunction): string => {
  if (status === "running") return t("执行中");
  return status === "failed" ? t("失败") : t("完成");
};

type SubagentEntryProps = {
  /** 入口文案；缺省是「查看进度」（面板里的实时项），历史条目传「查看子会话」 */
  label?: string;
  /** 任务简称；只作悬停提示，行里不铺开 */
  description: string;
  /** 实时项带上状态；历史条目（只有结果里的 `task_id`）没有状态可言，不传即不铺 */
  status?: ActivitySubagentStatus;
  onOpen: () => void;
};

export function SubagentEntry({ description, status, label, onOpen }: SubagentEntryProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className="flex shrink-0 items-center gap-1 rounded-xs bg-muted px-1.5 py-0.5 text-xs text-foreground-subtle hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      title={description ? `${t("子智能体")} · ${description}` : t("子智能体")}
      onClick={onOpen}
    >
      <Bot className="size-icon-sm shrink-0" />
      <span className="shrink-0">{label ?? t("查看进度")}</span>
      {status ? <span className="shrink-0">{statusText(status, t)}</span> : null}
    </button>
  );
}
