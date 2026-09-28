/** 模型设置对话框的草稿数据，以及「草稿 ↔ 配置接口」的双向转换 */
import type { ApiType, ProviderConfigView, ProviderModelView, ThinkingLevel } from "./types";

/** 数字字段用字符串承载，否则编辑中间态（空串、半截数字）会被 Number() 吃掉 */
export type DraftModel = {
  key: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
  /** 原样带回，表单不编辑 */
  cost: ProviderModelView["cost"];
  /** 原样带回，表单不编辑 */
  compat?: Record<string, unknown>;
};

export type DraftProvider = {
  key: string;
  id: string;
  name: string;
  baseUrl: string;
  api: ApiType;
  apiKey: string;
  /** 已保存 key 的脱敏展示，用作输入框 placeholder */
  apiKeyMasked: string;
  models: DraftModel[];
};

let keySeed = 0;

/** React key 生成器：表单条目可增删，不能用下标当 key */
export const nextDraftKey = (): string => {
  keySeed += 1;
  return `k${keySeed}`;
};

export const createDraftModel = (): DraftModel => ({
  key: nextDraftKey(),
  id: "",
  name: "",
  reasoning: true,
  contextWindow: "128000",
  maxTokens: "8192",
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

/** 空表单的缺省模板，按本地 OpenAI 兼容端点预填 */
export const createDraftProvider = (): DraftProvider => ({
  key: nextDraftKey(),
  id: "local",
  name: "Local Gateway",
  baseUrl: "http://localhost:8317/v1",
  api: "openai-completions",
  apiKey: "",
  apiKeyMasked: "",
  models: [
    {
      key: nextDraftKey(),
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      reasoning: true,
      contextWindow: "128000",
      maxTokens: "8192",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
});

export const toDraftProvider = (provider: ProviderConfigView): DraftProvider => ({
  key: nextDraftKey(),
  id: provider.id,
  name: provider.name,
  baseUrl: provider.baseUrl,
  api: provider.api,
  apiKey: "",
  apiKeyMasked: provider.apiKeyMasked,
  models: provider.models.map((model) => ({
    key: nextDraftKey(),
    id: model.id,
    name: model.name ?? "",
    reasoning: model.reasoning,
    contextWindow: String(model.contextWindow),
    maxTokens: String(model.maxTokens),
    cost: model.cost,
    compat: model.compat,
  })),
});

/** 草稿 → `config/update` 的 payload；apiKey 留空表示沿用服务端已保存的 key */
export const toUpdatePayload = (
  drafts: DraftProvider[],
  defaultModel: string | null,
  thinkingLevel: ThinkingLevel,
) => ({
  providers: drafts.map((provider) => ({
    id: provider.id.trim(),
    name: provider.name.trim() || undefined,
    baseUrl: provider.baseUrl.trim(),
    api: provider.api,
    ...(provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {}),
    models: provider.models.map((model) => ({
      id: model.id.trim(),
      name: model.name.trim() || undefined,
      reasoning: model.reasoning,
      contextWindow: Number(model.contextWindow) || 128000,
      maxTokens: Number(model.maxTokens) || 8192,
      cost: model.cost,
      ...(model.compat ? { compat: model.compat } : {}),
    })),
  })),
  defaultModel,
  thinkingLevel,
});

/** 「provider/model」选项，id 或模型 id 未填完整时跳过 */
export const modelOptions = (drafts: DraftProvider[]): Array<{ value: string; label: string }> =>
  drafts.flatMap((provider) =>
    provider.models
      .filter((model) => provider.id.trim() && model.id.trim())
      .map((model) => ({
        value: `${provider.id.trim()}/${model.id.trim()}`,
        label: `${provider.name || provider.id} · ${model.name || model.id}`,
      })),
  );
