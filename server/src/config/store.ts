/** config.json 的读写与对外视图（apiKey 脱敏） */
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

/** defaultModel 指向的 provider 已被替换掉时返回 null，让它回落到「第一个可用模型」 */
const reconcileDefaultModel = (
  ref: string | null,
  providers: AppConfig["providers"],
): string | null => {
  if (!ref) return null;
  const separator = ref.indexOf("/");
  if (separator <= 0) return null;
  const providerId = ref.slice(0, separator);
  return providers.some((provider) => provider.id === providerId) ? ref : null;
};

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

  /** 合并 patch，不落盘；调用方校验通过后再 `set()` */
  merge(patch: AppConfigPatchInput): AppConfig {
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

    // patch 显式给出 defaultModel（含 null）时以 patch 为准；否则沿用旧值，
    // 但旧值指向的 provider 已被这次替换掉时清空，避免留下悬空引用
    const defaultModel =
      "defaultModel" in patch
        ? (patch.defaultModel ?? null)
        : reconcileDefaultModel(this.config.defaultModel, providers ?? this.config.providers);

    return appConfigSchema.parse({
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
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    api: provider.api,
    apiKeyMasked: maskApiKey(provider.apiKey),
    ...(provider.models ? { models: provider.models } : {}),
  })),
});
