/**
 * 应用配置里的 provider → pi `registerProvider` 的入参。
 *
 * 与 pi 的 models.json 字段一一对应，唯一刻意的差异是不传 `apiKey`：
 * 凭证由 `PiRuntime` 用 `setRuntimeApiKey` 注入，避免同一份明文 key 落两处。
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderConfig } from "@ucode/contracts";

/**
 * `registerProvider` 的第二个入参。pi 没有从包根导出这个类型，
 * 所以从方法签名取，同样达到「不直接依赖 @earendil-works/pi-ai」的目的。
 */
export type PiProviderConfig = Parameters<ModelRuntime["registerProvider"]>[1];

export const toProviderConfigInput = (provider: ProviderConfig): PiProviderConfig => ({
  name: provider.name ?? provider.id,
  baseUrl: provider.baseUrl,
  api: provider.api,
  ...(provider.headers ? { headers: provider.headers } : {}),
  models: provider.models.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    ...(model.api ? { api: model.api } : {}),
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.headers ? { headers: model.headers } : {}),
    // 默认关闭 developer role：不少自建/代理网关只接受 system
    compat: { supportsDeveloperRole: false, ...(model.compat ?? {}) },
  })),
});
