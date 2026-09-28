/** provider 卡片里的模型列表：逐行编辑 + 增删 */
import { Plus } from "lucide-react";

import { ModelRow } from "@/components/settings/model-row";
import { Button } from "@/components/ui/button";
import type { DraftModel, DraftProvider } from "@/lib/config-draft";

type ProviderModelsProps = {
  models: DraftProvider["models"];
  onPatch: (modelKey: string, patch: Partial<DraftModel>) => void;
  onAdd: () => void;
  onRemove: (modelKey: string) => void;
};

export function ProviderModels({ models, onPatch, onAdd, onRemove }: ProviderModelsProps) {
  return (
    <div className="space-y-2">
      {models.map((model) => (
        <ModelRow
          key={model.key}
          model={model}
          onChange={(patch) => onPatch(model.key, patch)}
          onRemove={() => onRemove(model.key)}
        />
      ))}

      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="size-4" />
        添加模型
      </Button>
    </div>
  );
}
