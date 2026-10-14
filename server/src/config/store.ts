/** config.json 的读写与对外视图（apiKey 脱敏） */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  type AppConfig,
  type AppConfigPatchInput,
  appConfigSchema,
  type ConfigView,
  DEFAULT_SEARCH_PROVIDER,
  ERROR_CODES,
  KEYLESS_SEARCH_PROVIDERS,
  providerSchema,
  type WebsearchConfig,
} from "@ucode/contracts";

import { env } from "../env";
import { hardenOwnerOnly } from "../platform/file-permissions";
import { AppError } from "../platform/response";

export const emptyConfig = (): AppConfig => ({
  providers: [],
  defaultModel: null,
  websearch: { provider: DEFAULT_SEARCH_PROVIDER, apiKey: "", baseUrl: "" },
  memory: { enabled: false },
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
    // provider 的 apiKey 明文存在这里：权限得跟着文件走，而 Windows 上 chmod 不生效
    hardenOwnerOnly(this.path);
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

    // 搜索 key 与 provider 的 apiKey 同规则（留空沿用已保存的）；实例地址是普通文本，留空即清空
    const websearch = {
      provider: patch.websearch?.provider ?? this.config.websearch.provider,
      apiKey: patch.websearch?.apiKey?.trim() || this.config.websearch.apiKey,
      baseUrl: patch.websearch?.baseUrl?.trim() ?? this.config.websearch.baseUrl,
    };

    const memory = {
      enabled: patch.memory?.enabled ?? this.config.memory.enabled,
    };

    return appConfigSchema.parse({
      providers: providers ?? this.config.providers,
      defaultModel,
      websearch,
      memory,
    });
  }
}

export const maskApiKey = (apiKey: string): string =>
  apiKey.length <= 4 ? "****" : `****${apiKey.slice(-4)}`;

/** 对外返回的配置视图：apiKey 脱敏；不下发 provider 级 headers（可能含鉴权信息） */
export const publicConfig = (config: AppConfig): ConfigView => ({
  defaultModel: config.defaultModel,
  providers: config.providers.map((provider) => ({
    id: provider.id,
    name: provider.name ?? provider.id,
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    api: provider.api,
    apiKeyMasked: maskApiKey(provider.apiKey),
    ...(provider.models ? { models: provider.models } : {}),
  })),
  websearch: {
    provider: config.websearch.provider,
    apiKeyMasked: config.websearch.apiKey ? maskApiKey(config.websearch.apiKey) : "",
    baseUrl: config.websearch.baseUrl,
    configured: isWebsearchConfigured(config.websearch),
  },
  memory: { enabled: config.memory.enabled },
});

/** 搜索的前置条件按 provider 不同：自建实例要地址，其余要 key */
export const isWebsearchConfigured = (config: WebsearchConfig): boolean =>
  (KEYLESS_SEARCH_PROVIDERS as readonly string[]).includes(config.provider)
    ? config.baseUrl.length > 0
    : config.apiKey.length > 0;
