/** provider 卡片里的模型列表：拉取入口 + 逐行编辑 + 增删 */
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../base/button";
import {
  type DraftModel,
  type DraftModelFields,
  type DraftProvider,
  suggestionToModelFields,
} from "../../lib/config-draft";
import type { ProviderModelSuggestion } from "../../lib/types";
import { ModelRow } from "./model-row";
import { ProviderModelFetch } from "./provider-model-fetch";

type ProviderModelsProps = {
  provider: DraftProvider;
  onPatch: (modelKey: string, patch: Partial<DraftModel>) => void;
  onAdd: (fields?: DraftModelFields) => void;
  onRemove: (modelKey: string) => void;
};

export function ProviderModels({ provider, onPatch, onAdd, onRemove }: ProviderModelsProps) {
  const { t } = useTranslation();

  /** 草稿里已有同 id 的模型就改它，否则按建议新增一行，用户均可继续编辑 */
  const applySuggestion = (suggestion: ProviderModelSuggestion): void => {
    const fields = suggestionToModelFields(suggestion);
    const existing = provider.models.find((model) => model.id.trim() === suggestion.id);
    if (existing) onPatch(existing.key, fields);
    else onAdd(fields);
  };

  return (
    <div className="space-y-2">
      <ProviderModelFetch provider={provider} onSelect={applySuggestion} />

      {provider.models.map((model) => (
        <ModelRow
          key={model.key}
          model={model}
          onChange={(patch) => onPatch(model.key, patch)}
          onRemove={() => onRemove(model.key)}
        />
      ))}

      <Button variant="outline" size="sm" onClick={() => onAdd()}>
        <Plus className="size-4" />
        {t("添加模型")}
      </Button>
    </div>
  );
}
