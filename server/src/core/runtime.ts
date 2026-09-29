/** ModelRuntime 的生命周期：按配置重建、解析模型引用、导出模型目录 */
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type AppConfig,
  type CatalogModel,
  type CatalogProvider,
  ERROR_CODES,
  type RuntimeStatus,
} from "@ucode/contracts";

import { env } from "../env";
import { AppError } from "../lib/response";
import { toProviderConfigInput } from "./provider-config";

/** pi 的 Model 类型（避免直接依赖 @earendil-works/pi-ai） */
export type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

export const firstModelRef = (config: AppConfig): string | null => {
  const provider = config.providers[0];
  const model = provider?.models[0];
  return provider && model ? `${provider.id}/${model.id}` : null;
};

/**
 * 管理 pi 的 ModelRuntime：配置变更时重建，并把 provider 目录与凭证注入内存。
 *
 * 不落 `pi/models.json`：pi 的 `registerProvider` / `setRuntimeApiKey` 足以覆盖
 * 原先从 models.json 读取的全部内容，省掉一份派生文件与一份明文 `apiKey`。
 */
export class PiRuntime {
  private runtime: ModelRuntime | null = null;
  private providers: AppConfig["providers"] = [];
  private status: RuntimeStatus = {
    configured: false,
    defaultModel: null,
    thinkingLevel: "off",
    error: "尚未加载配置",
  };

  async apply(config: AppConfig): Promise<RuntimeStatus> {
    this.providers = config.providers;
    this.runtime = null;
    this.status = { ...this.status, configured: false, defaultModel: null, error: null };

    if (config.providers.length === 0) {
      this.status = {
        configured: false,
        defaultModel: null,
        thinkingLevel: config.thinkingLevel,
        error: "尚未配置模型 provider",
      };
      return this.status;
    }

    // modelsPath: null 让 pi 跳过读取模型目录文件，provider 全部由下面的注入决定
    const runtime = await ModelRuntime.create({
      authPath: env.authPath,
      modelsPath: null,
      refreshOnCreate: false,
    });

    for (const provider of config.providers) {
      runtime.registerProvider(provider.id, toProviderConfigInput(provider));
    }
    // 凭证必须在注册之后注入：setRuntimeApiKey 会顺带同步该 provider 的鉴权状态，
    // 而 getCatalog() 的 available 取自 hasConfiguredAuth()
    for (const provider of config.providers) {
      await runtime.setRuntimeApiKey(provider.id, provider.apiKey);
    }
    this.runtime = runtime;

    const wantedRef = config.defaultModel ?? firstModelRef(config);
    const model = this.resolveModelRef(wantedRef);
    if (!model) {
      this.status = {
        configured: false,
        defaultModel: null,
        thinkingLevel: config.thinkingLevel,
        error: `模型 ${wantedRef ?? "(未指定)"} 不可用，请检查 baseUrl / apiKey / 模型 id`,
      };
      return this.status;
    }

    this.status = {
      configured: true,
      defaultModel: `${model.provider}/${model.id}`,
      thinkingLevel: config.thinkingLevel,
      error: null,
    };
    return this.status;
  }

  getStatus(): RuntimeStatus {
    return this.status;
  }

  getRuntime(): ModelRuntime | null {
    return this.runtime;
  }

  requireRuntime(): ModelRuntime {
    if (!this.runtime) {
      throw new AppError(ERROR_CODES.modelNotConfigured, this.status.error ?? "模型未配置", 409);
    }
    return this.runtime;
  }

  /** 解析 "provider/model"；null/undefined 时回落到默认模型 */
  resolveModelRef(ref: string | null | undefined): PiModel | null {
    if (!this.runtime) return null;
    const target = ref ?? this.status.defaultModel;
    if (!target) return null;
    const separator = target.indexOf("/");
    if (separator <= 0) return null;
    const providerId = target.slice(0, separator);
    const modelId = target.slice(separator + 1);
    return this.runtime.getModel(providerId, modelId) ?? null;
  }

  getCatalog(): CatalogProvider[] {
    return this.providers.map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
      baseUrl: provider.baseUrl,
      api: provider.api,
      available: this.runtime ? this.runtime.hasConfiguredAuth(provider.id) : false,
      models: provider.models.map(
        (model): CatalogModel => ({
          id: model.id,
          name: model.name ?? model.id,
          reasoning: model.reasoning,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        }),
      ),
    }));
  }
}
