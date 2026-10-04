/** provider 卡片里的模型列表：逐行编辑 + 增删 */
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DraftModel, DraftProvider } from "../../lib/config-draft";
import { Button } from "../ui/button";
import { ModelRow } from "./model-row";

type ProviderModelsProps = {
  models: DraftProvider["models"];
  onPatch: (modelKey: string, patch: Partial<DraftModel>) => void;
  onAdd: () => void;
  onRemove: (modelKey: string) => void;
};

export function ProviderModels({ models, onPatch, onAdd, onRemove }: ProviderModelsProps) {
  const { t } = useTranslation();

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
        {t("添加模型")}
      </Button>
    </div>
  );
}
