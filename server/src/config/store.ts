/** config.json 的读写与对外视图（apiKey 脱敏），并转换成 pi 的 models.json */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  type AppConfig,
  type AppConfigPatchInput,
  appConfigSchema,
  type ConfigView,
  ERROR_CODES,
  providerSchema,
} from "@ucode/contracts";

import { env } from "../env";
import { AppError } from "../lib/response";

export const emptyConfig = (): AppConfig => ({
  providers: [],
  defaultModel: null,
  thinkingLevel: "off",
});

export class ConfigStore {
  private config: AppConfig = emptyConfig();

  constructor(private readonly path: string = env.configPath) {}

  load(): AppConfig {
    if (!existsSync(this.path)) {
      this.config = emptyConfig();
      return this.config;
    }
    try {
      this.config = appConfigSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      throw new AppError(
        ERROR_CODES.invalidConfig,
        `配置文件解析失败：${this.path}`,
        500,
        String(error),
      );
    }
    return this.config;
  }

  get(): AppConfig {
    return this.config;
  }

  set(next: AppConfig): AppConfig {
    const parsed = appConfigSchema.parse(next);
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    renameSync(tmp, this.path);
    this.config = parsed;
    return parsed;
  }

  update(patch: AppConfigPatchInput): AppConfig {
    const providers = patch.providers?.map((provider) => {
      const existing = this.config.providers.find((item) => item.id === provider.id);
      const parsed = providerSchema.safeParse({
        ...provider,
        // apiKey 留空时沿用已保存的 key
        apiKey: provider.apiKey?.trim() || existing?.apiKey,
      });
      if (!parsed.success) {
        throw new AppError(
          ERROR_CODES.invalidRequest,
          `provider "${provider.id}" 配置不完整`,
          400,
          parsed.error.issues,
        );
      }
      return parsed.data;
    });

    // patch 显式给出 defaultModel（含 null）时以 patch 为准
    const defaultModel =
      "defaultModel" in patch ? (patch.defaultModel ?? null) : this.config.defaultModel;

    return this.set({
      providers: providers ?? this.config.providers,
      defaultModel,
      thinkingLevel: patch.thinkingLevel ?? this.config.thinkingLevel,
    });
  }
}

export const maskApiKey = (apiKey: string): string =>
  apiKey.length <= 4 ? "****" : `****${apiKey.slice(-4)}`;

/** 对外返回的配置视图：apiKey 脱敏；不下发 provider 级 headers（可能含鉴权信息） */
export const publicConfig = (config: AppConfig): ConfigView => ({
  defaultModel: config.defaultModel,
  thinkingLevel: config.thinkingLevel,
  providers: config.providers.map((provider) => ({
    id: provider.id,
    name: provider.name ?? provider.id,
    baseUrl: provider.baseUrl,
    api: provider.api,
    apiKeyMasked: maskApiKey(provider.apiKey),
    models: provider.models,
  })),
});

/** 转成 pi 的 models.json 结构（含真实 apiKey，仅落在 .tmp 下） */
export const toModelsJson = (config: AppConfig) => ({
  providers: Object.fromEntries(
    config.providers.map((provider) => [
      provider.id,
      {
        name: provider.name ?? provider.id,
        baseUrl: provider.baseUrl,
        api: provider.api,
        apiKey: provider.apiKey,
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
          headers: model.headers,
          // 默认关闭 developer role：不少自建/代理网关只接受 system
          compat: { supportsDeveloperRole: false, ...(model.compat ?? {}) },
        })),
      },
    ]),
  ),
});
