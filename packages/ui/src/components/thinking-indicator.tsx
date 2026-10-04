/** 生成前的等待指示：空 assistant 占位与消息区尾部的 pending 行共用 */
import { useTranslation } from "react-i18next";

export function ThinkingIndicator() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-current" />
      {t("思考中…")}
    </div>
  );
}
