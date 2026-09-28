/** 草稿里某个 provider 的模型列表编辑：新增、删除、改字段 */
import { type Dispatch, type SetStateAction, useCallback } from "react";

import { createDraftModel, type DraftModel, type DraftProvider } from "@/lib/config-draft";

export function useConfigModels(setProviders: Dispatch<SetStateAction<DraftProvider[]>>) {
  const updateModels = useCallback(
    (providerKey: string, update: (models: DraftModel[]) => DraftModel[]) => {
      setProviders((prev) =>
        prev.map((provider) =>
          provider.key === providerKey
            ? { ...provider, models: update(provider.models) }
            : provider,
        ),
      );
    },
    [setProviders],
  );

  const patchModel = useCallback(
    (providerKey: string, modelKey: string, patch: Partial<DraftModel>) => {
      updateModels(providerKey, (models) =>
        models.map((model) => (model.key === modelKey ? { ...model, ...patch } : model)),
      );
    },
    [updateModels],
  );

  const addModel = useCallback(
    (providerKey: string) => {
      updateModels(providerKey, (models) => [...models, createDraftModel()]);
    },
    [updateModels],
  );

  const removeModel = useCallback(
    (providerKey: string, modelKey: string) => {
      updateModels(providerKey, (models) => models.filter((item) => item.key !== modelKey));
    },
    [updateModels],
  );

  return { patchModel, addModel, removeModel };
}
