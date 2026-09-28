/** 一个 provider 的配置卡片：连接信息 + 模型列表 + 连通性测试 / 删除 */
import { Loader2, Trash2, Zap } from "lucide-react";

import { ProviderFields } from "@/components/settings/provider-fields";
import { ProviderModels } from "@/components/settings/provider-models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { DraftModel, DraftProvider } from "@/lib/config-draft";

type ProviderCardProps = {
  provider: DraftProvider;
  testing: boolean;
  onPatch: (patch: Partial<DraftProvider>) => void;
  onModelPatch: (modelKey: string, patch: Partial<DraftModel>) => void;
  onAddModel: () => void;
  onRemoveModel: (modelKey: string) => void;
  onRemove: () => void;
  onTest: () => void;
};

export function ProviderCard({
  provider,
  testing,
  onPatch,
  onModelPatch,
  onAddModel,
  onRemoveModel,
  onRemove,
  onTest,
}: ProviderCardProps) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline">provider</Badge>
        <span className="text-xs text-muted-foreground">
          {provider.apiKeyMasked ? `已保存 key ${provider.apiKeyMasked}` : "未保存 key"}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onTest} disabled={testing}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
          测试连接
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} title="删除 provider">
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      <ProviderFields provider={provider} onPatch={onPatch} />

      <Separator />

      <ProviderModels
        models={provider.models}
        onPatch={onModelPatch}
        onAdd={onAddModel}
        onRemove={onRemoveModel}
      />
    </div>
  );
}
