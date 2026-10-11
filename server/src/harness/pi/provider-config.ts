/**
 * 应用配置里的 provider → pi `registerProvider` 的入参。
 *
 * 与 pi 的 models.json 字段一一对应，两处刻意的差异：
 * - 不传 `apiKey`：凭证由 `PiRuntime` 用 `setRuntimeApiKey` 注入，避免明文 key 落两处；
 * - pi 的 registerProvider 没有 provider 级 `compat`，所以把它折进每个模型的 compat。
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderConfig, ProviderModel } from "@ucode/contracts";

/**
 * `registerProvider` 的第二个入参。pi 没有从包根导出这个类型，
 * 所以从方法签名取，同样达到「不直接依赖 @earendil-works/pi-ai」的目的。
 */
export type PiProviderConfig = Parameters<ModelRuntime["registerProvider"]>[1];

type PiModelConfig = NonNullable<PiProviderConfig["models"]>[number];

const toModelConfig = (provider: ProviderConfig, model: ProviderModel): PiModelConfig => ({
  id: model.id,
  name: model.name ?? model.id,
  ...(model.api ? { api: model.api } : {}),
  ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
  reasoning: model.reasoning,
  ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
  input: model.input,
  ...(model.inputLimits ? { inputLimits: model.inputLimits } : {}),
  cost: model.cost,
  ...(model.promptCache ? { promptCache: model.promptCache } : {}),
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
  ...(model.samplingParams ? { samplingParams: model.samplingParams } : {}),
  ...(model.headers ? { headers: model.headers } : {}),
  compat: {
    // 默认关闭 developer role：不少自建/代理网关只接受 system
    supportsDeveloperRole: false,
    // 契约里的 compat 是自由格式透传，pi 那边按 api 收窄；校验留给 validateExtensionProvider
    ...provider.compat,
    ...model.compat,
  },
});

/**
 * provider 只给出 `baseUrl` / `models` 中被覆盖的部分，其余字段刻意缺席：
 * pi 会回落到内置目录的同名 provider（缺 `models` 时保留内置模型清单，
 * 缺 `baseUrl` 时沿用内置端点）。
 *
 * `inheritedBaseUrl` 是内置目录里的端点，仅在「物化了内置模型」时需要：
 * pi 的 `applyExtension` 只对命中内置默认值的模型 id 自动兜底端点，
 * 给出新模型 id 时没有 baseUrl 会直接抛错。
 */
export const toProviderConfigInput = (
  provider: ProviderConfig,
  inheritedBaseUrl?: string,
): PiProviderConfig => ({
  // 只在显式命名时才传 name：pi 的取值里扩展层优先级最高，传 id 会把内置供应商的显示名降级
  ...(provider.name ? { name: provider.name } : {}),
  ...(provider.baseUrl || inheritedBaseUrl
    ? { baseUrl: provider.baseUrl ?? inheritedBaseUrl }
    : {}),
  api: provider.api,
  ...(provider.headers ? { headers: provider.headers } : {}),
  ...(provider.authHeader !== undefined ? { authHeader: provider.authHeader } : {}),
  ...(provider.models
    ? { models: provider.models.map((model) => toModelConfig(provider, model)) }
    : {}),
});
