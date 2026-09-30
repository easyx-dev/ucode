/** 计划决策表单：plan 模式以 present_plan 收尾时替掉输入区，让用户批准或反馈 */
import { Check, Send } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type PlanDecisionFormProps = {
  /** 批准：切到编码模式并开始执行计划 */
  onApprove: () => void;
  /** 反馈：带着意见继续讨论计划 */
  onFeedback: (text: string) => void;
  disabled?: boolean;
};

export function PlanDecisionForm({ onApprove, onFeedback, disabled }: PlanDecisionFormProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");

  const submitFeedback = (): void => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onFeedback(text);
  };

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-xl bg-popover ring-1 ring-foreground/10">
          <div className="px-3 pt-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t("计划已就绪")}</span>
            {" · "}
            {t("计划已就绪.说明")}
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
            placeholder={t("反馈占位")}
            className="min-h-11 w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />

          <div className="flex items-center gap-2 px-3 pb-3">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || value.trim().length === 0}
              onClick={submitFeedback}
            >
              <Send className="size-3.5" />
              {t("提交反馈")}
            </Button>
            <Button size="sm" className="ml-auto" disabled={disabled} onClick={onApprove}>
              <Check className="size-4" />
              {t("批准并执行")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
