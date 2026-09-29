/** ModelRuntime 的生命周期：按配置重建、解析模型引用、导出模型目录 */
import { writeFileSync } from "node:fs";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type AppConfig,
  type CatalogModel,
  type CatalogProvider,
  ERROR_CODES,
  type RuntimeStatus,
} from "@ucode/contracts";

import { toModelsJson } from "../config/store";
import { env } from "../env";
import { AppError } from "../lib/response";

/** pi 的 Model 类型（避免直接依赖 @earendil-works/pi-ai） */
export type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

export const firstModelRef = (config: AppConfig): string | null => {
  const provider = config.providers[0];
  const model = provider?.models[0];
  return provider && model ? `${provider.id}/${model.id}` : null;
};

/**
 * 管理 pi 的 ModelRuntime：配置变更时重建，并把配置写成 pi 的 models.json。
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
    writeFileSync(env.modelsPath, `${JSON.stringify(toModelsJson(config), null, 2)}\n`, "utf8");

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

    const runtime = await ModelRuntime.create({
      authPath: env.authPath,
      modelsPath: env.modelsPath,
      refreshOnCreate: false,
    });
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
