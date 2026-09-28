/** 对话区头部的操作区：模型 / thinking 选择与运行时重建 */
import { RefreshCw, Settings2 } from "lucide-react";
import { ModelPicker } from "@/components/model-picker";
import { ThinkingPicker } from "@/components/thinking-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelsResponse, SessionSummary, ThinkingLevel } from "@/lib/types";

type ChatHeaderActionsProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onOpenSettings: () => void;
};

export function ChatHeaderActions({
  session,
  models,
  onReloadModels,
  onSelectModel,
  onSelectThinkingLevel,
  onOpenSettings,
}: ChatHeaderActionsProps) {
  const providers = models?.providers ?? [];

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      {models && !models.configured ? (
        <>
          <Badge variant="destructive">未配置模型</Badge>
          <Button size="sm" variant="outline" onClick={onOpenSettings}>
            <Settings2 className="size-4" />
            去设置
          </Button>
        </>
      ) : null}

      {providers.length > 0 ? (
        <ModelPicker
          providers={providers}
          value={session?.model ?? models?.defaultModel ?? ""}
          disabled={!session}
          onSelect={onSelectModel}
        />
      ) : null}

      {models?.configured ? (
        <ThinkingPicker
          value={session?.thinkingLevel ?? models.thinkingLevel}
          disabled={!session}
          onSelect={onSelectThinkingLevel}
        />
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onReloadModels}
            title="重建运行时"
          >
            <RefreshCw className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>丢弃内存会话并按当前配置重建运行时</TooltipContent>
      </Tooltip>
    </div>
  );
}
