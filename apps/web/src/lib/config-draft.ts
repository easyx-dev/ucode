/** 模型设置对话框的草稿数据，以及「草稿 ↔ 配置接口」的双向转换 */
import type {
  ApiType,
  CatalogProvider,
  ProviderConfigView,
  ProviderModelView,
  ThinkingLevel,
} from "./types";

/** 数字字段用字符串承载，否则编辑中间态（空串、半截数字）会被 Number() 吃掉 */
export type DraftModel = {
  key: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: string;
  maxTokens: string;
  /** 支持的输入类型；文本恒在，图片可选 */
  input: Array<"text" | "image">;
  /** pi 的 7 档推理等级 → 厂商取值；缺键 = 厂商默认，null = 该档不支持 */
  thinkingLevelMap: Partial<Record<ThinkingLevel, string | null>>;
  /** 以下字段表单不编辑，原样带回，避免编辑模型时误丢接口写入的配置 */
  api?: ApiType;
  baseUrl?: string;
  inputLimits?: ProviderModelView["inputLimits"];
  cost: ProviderModelView["cost"];
  promptCache?: ProviderModelView["promptCache"];
  samplingParams?: Record<string, unknown>;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
};

/** builtin = 接入 pi 内置目录的供应商；custom = 自描述端点与模型 */
export type DraftProviderSource = CatalogProvider["source"];

export type DraftProvider = {
  key: string;
  id: string;
  name: string;
  /** 仅 custom 可编辑；builtin 留空即继承内置目录的端点 */
  baseUrl: string;
  api: ApiType;
  apiKey: string;
  /** 已保存 key 的脱敏展示，用作输入框 placeholder */
  apiKeyMasked: string;
  source: DraftProviderSource;
  /** 该 provider 生效的端点：builtin 取目录值，custom 取表单值。用于连通性测试 */
  resolvedBaseUrl: string;
  /** 继承自 pi 内置目录的模型（只读展示与连通性测试用）；custom 为空数组 */
  inheritedModels: Array<{ id: string; name: string }>;
  models: DraftModel[];
};

let keySeed = 0;

/** React key 生成器：表单条目可增删，不能用下标当 key */
export const nextDraftKey = (): string => {
  keySeed += 1;
  return `k${keySeed}`;
};

/** 空模型草稿：文本输入恒开，其余取 pi 的默认值 */
export const createDraftModel = (): DraftModel => ({
  key: nextDraftKey(),
  id: "",
  name: "",
  reasoning: true,
  contextWindow: "128000",
  maxTokens: "8192",
  input: ["text"],
  thinkingLevelMap: {},
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
});

const toDraftModel = (model: ProviderModelView): DraftModel => ({
  key: nextDraftKey(),
  id: model.id,
  name: model.name ?? "",
  reasoning: model.reasoning,
  contextWindow: String(model.contextWindow),
  maxTokens: String(model.maxTokens),
  input: model.input,
  thinkingLevelMap: model.thinkingLevelMap ?? {},
  api: model.api,
  baseUrl: model.baseUrl,
  inputLimits: model.inputLimits,
  cost: model.cost,
  promptCache: model.promptCache,
  samplingParams: model.samplingParams,
  headers: model.headers,
  compat: model.compat,
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
  source: "custom",
  resolvedBaseUrl: "http://localhost:8317/v1",
  inheritedModels: [],
  models: [
    {
      ...createDraftModel(),
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
    },
  ],
});

/** 目录里的某个供应商 → 一条待接入的草稿（只需再填 key） */
export const fromCatalogProvider = (catalog: CatalogProvider): DraftProvider => ({
  key: nextDraftKey(),
  id: catalog.id,
  name: catalog.name,
  baseUrl: "",
  api: (catalog.api || "openai-completions") as ApiType,
  apiKey: "",
  apiKeyMasked: "",
  source: "builtin",
  resolvedBaseUrl: catalog.baseUrl ?? "",
  inheritedModels: catalog.models.map((model) => ({ id: model.id, name: model.name ?? model.id })),
  models: [],
});

/** 已保存的配置条目 → 草稿；builtin 的端点与模型清单由目录补齐 */
export const toDraftProvider = (
  provider: ProviderConfigView,
  catalog?: CatalogProvider,
): DraftProvider => ({
  key: nextDraftKey(),
  id: provider.id,
  // 内置供应商显示 pi 目录里的名字，而不是配置里回落的 id
  name: catalog?.name ?? provider.name,
  baseUrl: provider.baseUrl ?? "",
  api: provider.api,
  apiKey: "",
  apiKeyMasked: provider.apiKeyMasked,
  source: catalog?.source ?? "custom",
  resolvedBaseUrl: provider.baseUrl ?? catalog?.baseUrl ?? "",
  inheritedModels: (catalog?.models ?? []).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
  })),
  models: (provider.models ?? []).map(toDraftModel),
});

/** 保存前校验：自定义 provider 要有端点与模型，且每个模型都要有 id */
export const validateDrafts = (drafts: DraftProvider[]): string | null => {
  for (const provider of drafts) {
    const label = provider.name || provider.id || "(未命名)";
    if (provider.source === "builtin") continue;
    if (!provider.baseUrl.trim()) return `${label} 缺少 baseUrl`;
    if (provider.models.length === 0) return `${label} 至少要有一个模型`;
    if (provider.models.some((model) => !model.id.trim())) return `${label} 里有模型没填 id`;
  }
  return null;
};

/** 单个模型草稿 → 契约里的 `provider.models[]` 条目；空值一律不写进配置 */
const toModelPayload = (model: DraftModel) => ({
  id: model.id.trim(),
  name: model.name.trim() || undefined,
  reasoning: model.reasoning,
  contextWindow: Number(model.contextWindow) || 128000,
  maxTokens: Number(model.maxTokens) || 8192,
  input: model.input,
  cost: model.cost,
  ...(model.api ? { api: model.api } : {}),
  ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
  ...(Object.keys(model.thinkingLevelMap).length > 0
    ? { thinkingLevelMap: model.thinkingLevelMap }
    : {}),
  ...(model.inputLimits ? { inputLimits: model.inputLimits } : {}),
  ...(model.promptCache ? { promptCache: model.promptCache } : {}),
  ...(model.samplingParams ? { samplingParams: model.samplingParams } : {}),
  ...(model.headers ? { headers: model.headers } : {}),
  ...(model.compat ? { compat: model.compat } : {}),
});

/**
 * 草稿 → `config/update` 的 payload。
 * - apiKey 留空表示沿用服务端已保存的 key；
 * - builtin 只提交 `id` + `apiKey`，端点与模型清单由 pi 内置目录提供，
 *   这样内置目录升级（新增模型等）能自动生效。
 */
export const toUpdatePayload = (
  drafts: DraftProvider[],
  defaultModel: string | null,
  thinkingLevel: ThinkingLevel,
) => ({
  providers: drafts.map((provider) => {
    const apiKey = provider.apiKey.trim() ? { apiKey: provider.apiKey.trim() } : {};

    // 纯内置条目：名称、端点、模型清单都由 pi 内置目录提供，不进配置文件
    if (provider.source === "builtin" && provider.models.length === 0) {
      return { id: provider.id.trim(), ...apiKey };
    }

    return {
      id: provider.id.trim(),
      name: provider.name.trim() || undefined,
      // 留空即继承内置目录端点，不能提交空串（契约要求 min(1)，空串会被判为配置不完整）
      ...(provider.baseUrl.trim() ? { baseUrl: provider.baseUrl.trim() } : {}),
      api: provider.api,
      ...apiKey,
      models: provider.models.map(toModelPayload),
    };
  }),
  defaultModel,
  thinkingLevel,
});

/** 「provider/model」选项：只列实际生效的模型（内置取目录，自定义取表单） */
export const modelOptions = (drafts: DraftProvider[]): Array<{ value: string; label: string }> =>
  drafts.flatMap((provider) => {
    const id = provider.id.trim();
    if (!id) return [];
    const source =
      provider.inheritedModels.length > 0
        ? provider.inheritedModels
        : provider.models.map((model) => ({ id: model.id.trim(), name: model.name.trim() }));
    return source
      .filter((model) => model.id)
      .map((model) => ({
        value: `${id}/${model.id}`,
        label: `${provider.name || id} · ${model.name || model.id}`,
      }));
  });
