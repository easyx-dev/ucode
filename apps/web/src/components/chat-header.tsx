import { FolderOpen, RefreshCw, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sessionTitle } from "@/lib/session";
import type { CatalogProvider, ModelsResponse, SessionSummary, ThinkingLevel } from "@/lib/types";
import { THINKING_LEVELS } from "@/lib/types";

type ChatHeaderProps = {
  session: SessionSummary | null;
  models: ModelsResponse | null;
  modelsLoading: boolean;
  onReloadModels: () => void;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: ThinkingLevel) => void;
  onOpenSettings: () => void;
};

const modelOptions = (providers: CatalogProvider[]): Array<{ value: string; label: string }> =>
  providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.id}/${model.id}`,
      label: `${provider.name} · ${model.name}`,
    })),
  );

export function ChatHeader({
  session,
  models,
  modelsLoading,
  onReloadModels,
  onSelectModel,
  onSelectThinkingLevel,
  onOpenSettings,
}: ChatHeaderProps) {
  const options = modelOptions(models?.providers ?? []);
  const currentModel = session?.model ?? models?.defaultModel ?? "";

  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {session ? sessionTitle(session) : "未选择会话"}
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {modelsLoading ? <Skeleton className="h-8 w-40" /> : null}

        {!modelsLoading && models && !models.configured ? (
          <>
            <Badge variant="destructive">未配置模型</Badge>
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              <Settings2 className="size-4" />
              去设置
            </Button>
          </>
        ) : null}

        {!modelsLoading && options.length > 0 ? (
          <Select
            value={options.some((option) => option.value === currentModel) ? currentModel : undefined}
            onValueChange={onSelectModel}
            disabled={!session}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {!modelsLoading && models?.configured ? (
          <Select
            value={session?.thinkingLevel ?? models.thinkingLevel}
            onValueChange={(value) => onSelectThinkingLevel(value as ThinkingLevel)}
            disabled={!session}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue placeholder="thinking" />
            </SelectTrigger>
            <SelectContent>
              {THINKING_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" onClick={onReloadModels} title="重建运行时">
              <RefreshCw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>丢弃内存会话并按当前配置重建运行时</TooltipContent>
        </Tooltip>

        {session ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="hidden items-center gap-1 text-[10px] text-muted-foreground lg:flex">
                <FolderOpen className="size-3" />
                <span className="max-w-40 truncate">{session.cwd}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{session.cwd}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
}
