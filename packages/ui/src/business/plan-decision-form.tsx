/** 计划决策：plan 模式以 present_plan 收尾时由决策面板承接，让用户批准、补意见或忽略 */
import { Check, ClipboardList, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../base/button";
import { DecisionHeader } from "./decision-panel";

type PlanDecisionFormProps = {
  /** 批准：切到编码模式并开始执行计划 */
  onApprove: () => void;
  /** 忽略：本次计划不再弹决策表单（服务端往会话文件落标记） */
  onIgnore: () => void;
  /** 反馈：带着意见继续讨论计划 */
  onFeedback: (text: string) => void;
  disabled?: boolean;
};

/** 外壳由 `DecisionPanel` 提供——与权限审批、提问共用同一个外形 */
export function PlanDecisionForm({
  onApprove,
  onIgnore,
  onFeedback,
  disabled,
}: PlanDecisionFormProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  const submitFeedback = (): void => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onFeedback(text);
  };

  return (
    <>
      <DecisionHeader icon={ClipboardList} title={t("计划已就绪")} />

      <div className="px-3 pt-2.5 text-xs text-foreground-subtle">
        {t("批准后切换到编码模式开始执行；也可以在下方补充意见，继续讨论计划。")}
      </div>

      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitFeedback();
          }
        }}
        rows={2}
        placeholder={t("对计划有补充或异议？写在这里继续讨论")}
        className="min-h-11 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-foreground-subtle disabled:cursor-not-allowed"
      />

      <div className="flex items-center gap-2 px-3 pb-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={t("本次计划不再弹出决策表单")}
          onClick={onIgnore}
        >
          {t("忽略")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || value.trim().length === 0}
          onClick={submitFeedback}
        >
          <Send className="size-icon-sm" />
          {t("提交反馈")}
        </Button>
        <Button size="sm" className="ml-auto" disabled={disabled} onClick={onApprove}>
          <Check className="size-icon-base" />
          {t("批准并执行")}
        </Button>
      </div>
    </>
  );
}
