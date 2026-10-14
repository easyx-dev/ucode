/** provider 卡片里的模型列表：区块标题承载动作，逐行的字段编辑在对话框里完成 */
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import { Empty } from "../../../base/empty";
import type { ProviderModelSuggestion } from "../../../types";
import {
  type DraftModel,
  type DraftModelFields,
  type DraftProvider,
  suggestionToModelFields,
} from "../config-draft";
import { SettingsSectionHeader } from "../settings-page";
import { SettingsGroup } from "../settings-row";
import { ModelFormDialog } from "./model-form-dialog";
import { ModelRow } from "./model-row";
import { ModelFetchButton, ModelFetchResult } from "./provider-model-fetch";
import { useProviderModelFetch } from "./use-provider-model-fetch";

type ProviderModelsProps = {
  provider: DraftProvider;
  onPatch: (modelKey: string, patch: Partial<DraftModel>) => void;
  /** 追加一条模型并返回它的草稿 key：新加的条目直接进编辑对话框 */
  onAdd: (fields?: DraftModelFields) => string;
  onRemove: (modelKey: string) => void;
};

export function ProviderModels({ provider, onPatch, onAdd, onRemove }: ProviderModelsProps) {
  const { t } = useTranslation();
  const { fetching, result, fetch, discard } = useProviderModelFetch();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // 选中的条目被删掉时自动落空，无需 effect 纠正
  const editing = provider.models.find((model) => model.key === editingKey) ?? null;

  /** 草稿里已有同 id 的模型就改它，否则按建议新增一条；两种都直接打开对话框让人核对 */
  const applySuggestion = (suggestion: ProviderModelSuggestion): void => {
    const fields = suggestionToModelFields(suggestion);
    const existing = provider.models.find((model) => model.id.trim() === suggestion.id);
    if (existing) {
      onPatch(existing.key, fields);
      setEditingKey(existing.key);
      return;
    }
    setEditingKey(onAdd(fields));
  };

  return (
    <section className="space-y-3">
      <SettingsSectionHeader
        title={t("模型列表")}
        meta={t("{{count}} 个", { count: provider.models.length })}
        action={
          <>
            <ModelFetchButton provider={provider} fetching={fetching} onFetch={fetch} />
            <Button size="sm" onClick={() => setEditingKey(onAdd())}>
              <Plus className="size-icon-base" />
              {t("添加模型")}
            </Button>
          </>
        }
      />

      {result ? (
        <ModelFetchResult result={result} onSelect={applySuggestion} onDiscard={discard} />
      ) : null}

      {provider.models.length === 0 ? (
        <Empty
          className="rounded-xl border border-dashed px-4 py-6"
          title={t("还没有模型：拉取上游列表，或手动添加一个。")}
        />
      ) : (
        <SettingsGroup>
          {provider.models.map((model) => (
            <ModelRow
              key={model.key}
              model={model}
              onEdit={() => setEditingKey(model.key)}
              onToggleReasoning={(enabled) => onPatch(model.key, { reasoning: enabled })}
              onRemove={() => onRemove(model.key)}
            />
          ))}
        </SettingsGroup>
      )}

      {editing ? (
        <ModelFormDialog
          // 按模型重挂载：对话框里的局部状态不跟着上一个条目串门
          key={editing.key}
          model={editing}
          onPatch={(patch) => onPatch(editing.key, patch)}
          onOpenChange={(open) => {
            if (!open) setEditingKey(null);
          }}
        />
      ) : null}
    </section>
  );
}
