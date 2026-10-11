/** 模型设置对话框的草稿数据，以及「草稿 ↔ 配置接口」的双向转换 */

import type { TFunction } from "i18next";
import type {
  ApiType,
  CatalogProvider,
  ProviderConfigView,
  ProviderModelSuggestion,
  ProviderModelView,
  SearchProviderId,
  ThinkingLevel,
  WebsearchView,
} from "./types";

/** 数字字段用字符串承载，否则编辑中间态（空串、半截数字）会被 Number() 吃掉 */
export type DraftModel = {
  key: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: string;
  /** 有效上下文预算（压缩触发点）；留空表示按窗口自动推算 */
  contextBudget: string;
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

/** 模型的可编辑字段：新增与预填时只给这些，`key` 由草稿层自行生成 */
export type DraftModelFields = Partial<Omit<DraftModel, "key">>;

/** builtin = 接入 pi 内置目录的供应商；custom = 自描述端点与模型 */
export type DraftProviderSource = CatalogProvider["source"];

/** 联网搜索草稿：已保存的 key 只回显脱敏值，输入框留空表示沿用 */
export type DraftWebsearch = {
  provider: SearchProviderId;
  apiKey: string;
  /** 已保存 key 的脱敏展示，用作输入框 placeholder */
  apiKeyMasked: string;
  /** 自建 SearXNG 的实例地址；其他 provider 不使用 */
  baseUrl: string;
  configured: boolean;
};

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
  contextBudget: "",
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
  contextBudget: model.contextBudget === undefined ? "" : String(model.contextBudget),
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

/** 已保存的联网搜索设置 → 草稿；key 只带脱敏值，输入框留空 */
export const toDraftWebsearch = (view: WebsearchView): DraftWebsearch => ({
  provider: view.provider,
  apiKey: "",
  apiKeyMasked: view.apiKeyMasked,
  baseUrl: view.baseUrl,
  configured: view.configured,
});

/**
 * 上游拉取到的模型建议 → 草稿字段：上游能给的只有能力推断结果，其余字段（api / cost 等）
 * 保持表单默认值，用户可在模型行里继续改。
 */
export const suggestionToModelFields = (suggestion: ProviderModelSuggestion): DraftModelFields => ({
  id: suggestion.id,
  // 上游没给展示名时服务端回落为 id，此时留空，避免表单里 id 与显示名重复
  name: suggestion.name === suggestion.id ? "" : suggestion.name,
  reasoning: suggestion.reasoning,
  contextWindow: String(suggestion.contextWindow),
  maxTokens: String(suggestion.maxTokens),
  input: suggestion.vision ? ["text", "image"] : ["text"],
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
export const catalogToDraftProvider = (catalog: CatalogProvider): DraftProvider => ({
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

/**
 * 草稿是否已可保存生效，用于列表里的状态点：
 * 内置供应商只缺 key；自定义供应商要有端点，且每个模型都得填 id（key 可留空，本地端点常不需要）。
 */
export const isDraftProviderReady = (provider: DraftProvider): boolean => {
  if (provider.source === "builtin")
    return Boolean(provider.apiKey.trim() || provider.apiKeyMasked);
  return (
    Boolean(provider.baseUrl.trim()) &&
    provider.models.length > 0 &&
    provider.models.every((model) => model.id.trim().length > 0)
  );
};

/**
 * 数字字段：留空表示用默认值；填了就必须是正整数。
 * 不拦的话它会以 NaN / 负数 / 小数发到服务端，用户只看到一句校验失败，看不出是哪个框写错了。
 */
const numberProblem = (
  value: string,
  field: string,
  label: string,
  t: TFunction,
): string | null => {
  const raw = value.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0
    ? null
    : t("{{label}} 的{{field}}要填正整数", { label, field });
};

/** 保存前校验：自定义 provider 要有端点与模型，每个模型都要有 id，数字字段要是正整数 */
export const validateDrafts = (drafts: DraftProvider[], t: TFunction): string | null => {
  for (const provider of drafts) {
    const label = provider.name || provider.id || t("(未命名)");
    if (provider.source === "builtin") continue;
    if (!provider.baseUrl.trim()) return t("{{label}} 缺少 baseUrl", { label });
    if (provider.models.length === 0) return t("{{label}} 至少要有一个模型", { label });
    if (provider.models.some((model) => !model.id.trim()))
      return t("{{label}} 里有模型没填 id", { label });
    for (const model of provider.models) {
      const modelLabel = model.id.trim() || label;
      // 字段名走 t()：它要出现在提示语里，也得跟着语言走
      for (const [field, value] of [
        [t("上下文窗口"), model.contextWindow],
        [t("上下文预算"), model.contextBudget],
        [t("最大输出"), model.maxTokens],
      ] as const) {
        const problem = numberProblem(value, field, modelLabel, t);
        if (problem) return problem;
      }
    }
  }
  return null;
};

/** 单个模型草稿 → 契约里的 `provider.models[]` 条目；空值一律不写进配置 */
const toModelPayload = (model: DraftModel) => ({
  id: model.id.trim(),
  name: model.name.trim() || undefined,
  reasoning: model.reasoning,
  contextWindow: Number(model.contextWindow) || 128000,
  // 留空即不写进配置：预算由服务端按窗口推算（见 harness/setup/budget）
  ...(Number(model.contextBudget) > 0 ? { contextBudget: Number(model.contextBudget) } : {}),
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
  websearch: DraftWebsearch,
  memoryEnabled: boolean,
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
  websearch: {
    provider: websearch.provider,
    // 留空表示沿用服务端已保存的 key
    ...(websearch.apiKey.trim() ? { apiKey: websearch.apiKey.trim() } : {}),
    baseUrl: websearch.baseUrl.trim(),
  },
  memory: { enabled: memoryEnabled },
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
