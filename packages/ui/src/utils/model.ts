/** 模型与供应商的界面显示名：取模型目录里的名称，目录里查不到才回落原 ID */

import type { CatalogProvider } from "../types";

/**
 * 「供应商名 · 模型名」的拼法。设置页的默认模型下拉拿草稿拼同一套文案（草稿里可能有还没保存的改名），
 * 两边共用这一处，免得改了分隔符只有一半跟着变。
 */
export const modelRefText = (providerName: string, modelName: string): string =>
  `${providerName} · ${modelName}`;

/** 名称的三个读法：都以「模型目录 → 原 ID」取值 */
export type ModelNames = {
  /** 供应商显示名 */
  providerName: (providerId: string) => string;
  /** 模型显示名；`providerId` 缺省时（条目没记 provider）按 model id 在目录里找一次 */
  modelName: (providerId: string | undefined, modelId: string) => string;
  /** 「供应商 · 模型」；`ref` 不是 `provider/model` 形式时原样返回 */
  refLabel: (ref: string) => string;
};

/**
 * 名称与 ID 的取舍在服务端就定完了：pi 目录里的 `name` 缺省即等于 `id`
 * （见 `harness/pi/provider-config.ts`），所以自定义名称与「回落原 ID」在目录里是同一份值。
 * 这里只处理目录里查不到的情况——配置改过模型清单、或目录还没加载到。
 */
export const modelNamesOf = (providers: readonly CatalogProvider[]): ModelNames => {
  const providerOf = (providerId: string): CatalogProvider | undefined =>
    providers.find((provider) => provider.id === providerId);
  const providerName = (providerId: string): string => providerOf(providerId)?.name || providerId;
  const modelName = (providerId: string | undefined, modelId: string): string => {
    if (providerId) {
      return providerOf(providerId)?.models.find((model) => model.id === modelId)?.name || modelId;
    }
    // 条目没记 provider 就没有归属可查：按 id 在目录里找一次，找不到仍按原 ID
    for (const provider of providers) {
      const name = provider.models.find((model) => model.id === modelId)?.name;
      if (name) return name;
    }
    return modelId;
  };

  return {
    providerName,
    modelName,
    refLabel: (ref) => {
      // 按首个 "/" 切：与服务端解析模型引用的口径一致（模型 id 自身可能含斜杠）
      const separator = ref.indexOf("/");
      if (separator <= 0) return ref;
      const providerId = ref.slice(0, separator);
      return modelRefText(
        providerName(providerId),
        modelName(providerId, ref.slice(separator + 1)),
      );
    },
  };
};
