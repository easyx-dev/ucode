/** 对话区头部：会话标题、运行态与运行时操作 */
import { Loader2, RefreshCw, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sessionTitle } from "@/lib/session";
import type { ModelsResponse, SessionSummary } from "@/lib/types";

type ChatHeaderProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  onReloadModels: () => void;
  onOpenSettings: () => void;
};

export function ChatHeader({ session, models, onReloadModels, onOpenSettings }: ChatHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
      <div className="min-w-0 truncate text-sm font-medium">
        {session ? sessionTitle(session, t("新会话")) : t("未选择会话")}
      </div>

      {session?.running ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {t("生成中")}
        </span>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {models && !models.configured ? (
          <>
            <Badge variant="destructive">{t("未配置模型")}</Badge>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              <Settings2 className="size-4" />
              {t("去设置")}
            </Button>
          </>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onReloadModels}
              title={t("重建运行时")}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("重建运行时.说明")}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
