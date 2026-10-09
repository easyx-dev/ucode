/**
 * ModelRuntime 的生命周期：按配置重建、解析模型引用、导出供应商目录。
 *
 * provider 目录与凭证都注入内存，不落 `harness/models.json`：pi 的 `registerProvider`
 * 与 `setRuntimeApiKey` 足以覆盖原先从 models.json 读取的全部内容。
 */
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  type AppConfig,
  type CatalogModel,
  type CatalogProvider,
  ERROR_CODES,
  type ProviderConfig,
  type RuntimeStatus,
} from "@ucode/contracts";

import { env } from "../env";
import { AppError } from "../lib/response";
import { toProviderConfigInput } from "./provider-config";

/** pi 的 Model 类型（避免直接依赖 @earendil-works/pi-ai） */
export type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
/** pi 的 Provider 类型 */
type PiProvider = NonNullable<ReturnType<ModelRuntime["getProvider"]>>;

/** 一次构建的产物：还没切换进实例，构建失败不影响当前运行时 */
export type BuiltRuntime = {
  runtime: ModelRuntime;
  /** pi 内置 provider id 集合，在注册自定义 provider 之前采集 */
  builtinIds: Set<string>;
  /** 这次构建用的 provider 配置 */
  providers: AppConfig["providers"];
};

/** 配置里第一个 provider 的首个模型；内置条目可能没有 `models`，此时返回 null */
export const firstModelRef = (config: AppConfig): string | null => {
  const provider = config.providers[0];
  const model = provider?.models?.[0];
  return provider && model ? `${provider.id}/${model.id}` : null;
};

/** 目录条目：只带聊天区选择器需要的字段，完整参数不随目录下发 */
const toCatalogModel = (model: PiModel, withLimits: boolean): CatalogModel => ({
  id: model.id,
  name: model.name,
  reasoning: model.reasoning,
  vision: model.input.includes("image"),
  ...(withLimits ? { contextWindow: model.contextWindow, maxTokens: model.maxTokens } : {}),
});

export class PiRuntime {
  private runtime: ModelRuntime | null = null;
  private providers: AppConfig["providers"] = [];
  /**
   * pi 内置 provider id 集合。每次 apply 在注册自定义 provider **之前**采集，
   * 用于校验配置、以及区分目录条目的来源。
   */
  private builtinIds = new Set<string>();
  private status: RuntimeStatus = {
    configured: false,
    defaultModel: null,
    error: "尚未加载配置",
  };

  /**
   * 按配置构建一个全新的 ModelRuntime。只读自身已有状态，失败时不改动当前运行时，
   * 让调用方能「先构建、后切换」，不会留下「配置已换、运行时为空」的半截状态。
   */
  async build(config: AppConfig): Promise<BuiltRuntime> {
    // modelsPath: null 让 pi 跳过读取模型目录文件，provider 全部由下面的注入决定
    const runtime = await ModelRuntime.create({
      authPath: env.authPath,
      modelsPath: null,
      refreshOnCreate: false,
    });
    const builtinIds = new Set(runtime.getProviders().map((provider) => provider.id));

    for (const provider of config.providers) {
      // 只有覆盖了 baseUrl / models 才需要注册；纯内置条目（id + apiKey）交给 pi 的内置目录
      if (provider.baseUrl || provider.models) {
        // 物化内置模型时要补上内置端点，否则 pi 对「新模型 id」无法兜底
        const inheritedBaseUrl = runtime.getProvider(provider.id)?.baseUrl;
        runtime.registerProvider(provider.id, toProviderConfigInput(provider, inheritedBaseUrl));
      }
      await runtime.setRuntimeApiKey(provider.id, provider.apiKey);
    }
    // 刷新鉴权快照，让目录的 available 对「运行时注入的 key」与「环境变量」两种来源都准确
    await runtime.refresh({ allowNetwork: false });

    return { runtime, builtinIds, providers: config.providers };
  }

  /** 切换到一份构建好的运行时并重算状态；同步完成，调用方可在同一帧里落盘配置 */
  swap(built: BuiltRuntime, config: AppConfig): RuntimeStatus {
    this.runtime = built.runtime;
    this.builtinIds = built.builtinIds;
    this.providers = built.providers;

    const wantedRef = config.defaultModel ?? firstModelRef(config) ?? this.firstAvailableRef();
    const model = this.resolveModelRef(wantedRef);
    if (!model) {
      this.status = {
        configured: false,
        defaultModel: null,
        error:
          config.providers.length === 0
            ? "尚未接入模型供应商"
            : `模型 ${wantedRef ?? "(未指定)"} 不可用，请检查 baseUrl / apiKey / 模型 id`,
      };
      return this.status;
    }

    this.status = {
      configured: true,
      defaultModel: `${model.provider}/${model.id}`,
      error: null,
    };
    return this.status;
  }

  /** 构建并切换；启动路径与需要重建的调用方用它一步到位 */
  async apply(config: AppConfig): Promise<RuntimeStatus> {
    return this.swap(await this.build(config), config);
  }

  /**
   * 校验配置里的 provider 都能落地。pi 内置 provider 可以只给 `id` + `apiKey`
   * （其余继承内置目录），其它 provider 必须自带 `baseUrl` 与 `models`，
   * 否则 pi 会得到一个没有任何模型的空 provider。
   *
   * 必须在落盘前调用，避免不可用的配置写进 config.json。
   */
  assertUsable(config: AppConfig): void {
    for (const provider of config.providers) {
      if (this.builtinIds.has(provider.id)) continue;
      if (provider.baseUrl && provider.models) continue;
      throw new AppError(
        ERROR_CODES.invalidRequest,
        `provider "${provider.id}" 不是 pi 内置供应商，必须同时给出 baseUrl 与 models`,
        400,
      );
    }
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

  /** 模型上下文窗口；模型解析不到或没声明窗口时返回 null */
  contextWindowOf(ref: string | null): number | null {
    const contextWindow = this.resolveModelRef(ref)?.contextWindow ?? 0;
    return contextWindow > 0 ? contextWindow : null;
  }

  /**
   * 该模型的有效上下文预算覆盖值（配置里的 `contextBudget`）；没配就是 null，由调用方按窗口推算。
   * 判据不能只看模型声明的窗口：1M 的声明值常常远大于可用窗口。
   */
  contextBudgetOf(ref: string | null): number | null {
    const target = ref ?? this.status.defaultModel;
    if (!target) return null;
    const separator = target.indexOf("/");
    if (separator <= 0) return null;
    const provider = this.providers.find((item) => item.id === target.slice(0, separator));
    const model = provider?.models?.find((item) => item.id === target.slice(separator + 1));
    return model?.contextBudget ?? null;
  }

  /** 配置未指定默认模型时的回落：第一个已配置鉴权的可用模型 */
  private firstAvailableRef(): string | null {
    const model = this.runtime?.getAvailableSnapshot()[0];
    return model ? `${model.provider}/${model.id}` : null;
  }

  /**
   * 供应商目录：pi 内置目录里「一把 key 就能接入」的 provider，加上配置里自定义的。
   * 内置目录里端点为 null（按凭证解析）或只有 OAuth 的 provider 不在此列。
   */
  getCatalog(): CatalogProvider[] {
    if (!this.runtime) return [];
    const configured = new Map(this.providers.map((provider) => [provider.id, provider]));

    return this.runtime
      .getProviders()
      .filter((provider) => {
        if (configured.has(provider.id)) return true;
        return Boolean(provider.baseUrl) && Boolean(provider.auth.apiKey);
      })
      .map((provider) => this.toCatalogProvider(provider, configured.get(provider.id)))
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === "custom" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  private toCatalogProvider(
    provider: PiProvider,
    entry: ProviderConfig | undefined,
  ): CatalogProvider {
    const piModels = this.runtime?.getModels(provider.id) ?? [];
    const authStatus = this.runtime?.getProviderAuthStatus(provider.id) ?? { configured: false };

    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl ?? null,
      api: entry?.api ?? piModels[0]?.api ?? "",
      source: this.builtinIds.has(provider.id) ? "builtin" : "custom",
      available: authStatus.configured,
      authSource: authStatus.source ?? null,
      authName: provider.auth.apiKey?.name ?? provider.auth.oauth?.name ?? "",
      // 给出了 models 即为整体替换，此后不再跟随内置目录更新
      customized: Boolean(entry?.models),
      models: piModels.map((model) => toCatalogModel(model, authStatus.configured)),
    };
  }
}
