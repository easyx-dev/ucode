/** 草稿里某个 provider 的模型列表编辑：新增、删除、改字段 */
import { type Dispatch, type SetStateAction, useCallback } from "react";

import {
  createDraftModel,
  type DraftModel,
  type DraftModelFields,
  type DraftProvider,
} from "../lib/config-draft";

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

  /** 追加一条模型；`fields` 用于按提示预填（拉取到的上游模型建议）。返回新模型的草稿 key，供调用方直接打开它的编辑对话框 */
  const addModel = useCallback(
    (providerKey: string, fields: DraftModelFields = {}): string => {
      const model = { ...createDraftModel(), ...fields };
      updateModels(providerKey, (models) => [...models, model]);
      return model.key;
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
