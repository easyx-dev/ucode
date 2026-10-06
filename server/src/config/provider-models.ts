/**
 * 按 provider 配置拉取可用模型列表：请求构造、多种返回形态的解析、能力补齐与可读错误。
 *
 * pi 没有「列出某个 provider 的模型」的能力：`getProviders` / `getModels` 读的是内存快照，
 * `refresh` 只对内置 provider 的远程目录生效（见 `core/runtime.ts`），所以这里自己打
 * `GET {baseUrl}/models`，只做「看得到有哪些模型」，不写任何配置。
 */
import {
  type ApiType,
  type CatalogModel,
  ERROR_CODES,
  type ProviderModel,
  type ProviderModelSuggestion,
  type ProviderModelsResponse,
} from "@ucode/contracts";

import { AppError } from "../lib/response";
import { type CapabilityValues, inferModelCapabilities } from "./model-capabilities";

/** 拉取模型列表的超时；与 config/test 的连通性测试同档，避免设置页长时间转圈 */
const REQUEST_TIMEOUT_MS = 20_000;

/** 单次下发的条数上限：上游目录动辄上千条，界面用不上，也免得撑爆响应 */
const MAX_MODELS = 500;

/** 上游条目里读取上下文窗口的候选键，按顺序取第一个可用值（各家命名不一） */
const CONTEXT_WINDOW_KEYS = [
  "context_window",
  "context_length",
  "max_context_length",
  "max_model_len",
];

/** 上游条目里读取输出上限的候选键 */
const MAX_TOKENS_KEYS = ["max_output_tokens", "max_completion_tokens", "max_tokens"];

/** 上游存放模型列表的候选键：OpenAI 兼容用 `data`，部分网关用 `models` / `result` / `items` */
const LIST_KEYS = ["data", "models", "result", "items"];

/** 常见状态码的排查提示：把「key 不对」「少了路径段」这类方向直接说清楚 */
const STATUS_HINTS: Record<number, string> = {
  401: "鉴权失败，检查 apiKey",
  403: "上游拒绝访问，检查 apiKey 的权限",
  404: "该端点没有 /models，检查 baseUrl 是否缺少 /v1 之类的路径段",
  405: "该端点不允许 GET 请求，检查 baseUrl",
  429: "请求过于频繁，稍后重试",
};

/** 上游条目里能直接读到的部分；`contextWindow` / `maxTokens` 只在带元数据的网关上存在 */
export type RawModelEntry = {
  id: string;
  name: string;
  contextWindow: number | null;
  maxTokens: number | null;
};

export type ProviderModelsQuery = {
  baseUrl: string;
  apiKey: string;
  api: ApiType;
  /** 当前 provider 已保存的模型：能力推断的最高优先级来源 */
  configuredModels?: ProviderModel[];
  /** pi 内置目录里同 provider 的模型；未接入的内置 provider 拿不到 */
  catalogModels?: CatalogModel[];
};

const readPositiveInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

const firstPositiveInt = (source: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = readPositiveInt(source[key]);
    if (value !== null) return value;
  }
  return null;
};

/**
 * 取条目的 id：字符串条目本身就是 id，对象条目按常见别名取（`model` / `modelId` 见于部分网关）。
 * 不用 `name` 兜底：那是展示名，当成 id 存进配置后请求会打错模型。
 */
const idOf = (entry: unknown): string | null => {
  if (typeof entry === "string") return entry.trim() || null;
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  for (const key of ["id", "model", "modelId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const entryToRecord = (entry: unknown): RawModelEntry | null => {
  const id = idOf(entry);
  if (!id) return null;
  if (!entry || typeof entry !== "object") {
    return { id, name: id, contextWindow: null, maxTokens: null };
  }

  const record = entry as Record<string, unknown>;
  const rawName = record.name ?? record.display_name;
  return {
    id,
    name: typeof rawName === "string" && rawName.trim() ? rawName.trim() : id,
    contextWindow: firstPositiveInt(record, CONTEXT_WINDOW_KEYS),
    maxTokens: firstPositiveInt(record, MAX_TOKENS_KEYS),
  };
};

/** 从响应体里取出条目数组；形态不认识时返回空数组，由调用方翻成可读错误 */
const listOf = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of LIST_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

/**
 * 解析上游响应体：接受裸数组、`{ data: [...] }`、`{ models: [...] }` 等形态，
 * 条目可以是字符串或带 id 的对象；按出现顺序去重，无 id 的条目丢弃。
 */
export const parseProviderModels = (payload: unknown): RawModelEntry[] => {
  const seen = new Set<string>();
  const models: RawModelEntry[] = [];

  for (const item of listOf(payload)) {
    const entry = entryToRecord(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    models.push(entry);
  }

  return models;
};

/** 已保存的配置条目 → 推断线索 */
const configuredValuesOf = (model: ProviderModel): CapabilityValues => ({
  reasoning: model.reasoning,
  vision: model.input.includes("image"),
  contextWindow: model.contextWindow,
  maxTokens: model.maxTokens,
});

/** pi 内置目录条目 → 推断线索；未接入的条目没有窗口参数 */
const catalogValuesOf = (model: CatalogModel): CapabilityValues => ({
  reasoning: model.reasoning,
  vision: model.vision,
  contextWindow: model.contextWindow ?? null,
  maxTokens: model.maxTokens ?? null,
});

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

const toSuggestion = (
  entry: RawModelEntry,
  configuredModel: ProviderModel | undefined,
  catalogModel: CatalogModel | undefined,
): ProviderModelSuggestion => {
  const capabilities = inferModelCapabilities(entry.id, {
    configured: configuredModel ? configuredValuesOf(configuredModel) : undefined,
    upstream: {
      reasoning: null,
      vision: null,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
    },
    catalog: catalogModel ? catalogValuesOf(catalogModel) : undefined,
  });

  return {
    id: entry.id,
    name: entry.name,
    reasoning: capabilities.reasoning,
    vision: capabilities.vision,
    contextWindow: capabilities.contextWindow,
    maxTokens: capabilities.maxTokens,
    capabilitySource: capabilities.source,
    configured: configuredModel !== undefined,
  };
};

/**
 * 拉取并按 id 补齐能力。除「上游不可达 / 鉴权失败 / 响应不是模型列表」外不抛错：
 * 上游给出的 id 一律照收，能力拿不准就按推断层回落，交给设置页让用户确认。
 */
export const fetchProviderModels = async (
  query: ProviderModelsQuery,
): Promise<ProviderModelsResponse> => {
  if (query.api !== "openai-completions") {
    throw new AppError(
      ERROR_CODES.unsupportedApi,
      `拉取模型列表目前只支持 openai-completions，当前为 ${query.api}`,
      400,
      undefined,
      { api: query.api },
    );
  }

  const url = `${query.baseUrl.replace(/\/+$/, "")}/models`;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${query.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(
      ERROR_CODES.upstreamUnreachable,
      isTimeout(error)
        ? `拉取模型列表超时（${REQUEST_TIMEOUT_MS / 1000} 秒）：${url}`
        : `无法连接 ${url}`,
      400,
      String(error),
      { url },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    const hint = STATUS_HINTS[response.status];
    throw new AppError(
      ERROR_CODES.upstreamError,
      `上游返回 HTTP ${response.status}${hint ? `（${hint}）` : ""}`,
      400,
      text.slice(0, 800),
      { url, status: String(response.status) },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AppError(
      ERROR_CODES.upstreamError,
      `上游返回的不是 JSON（可能是网关的错误页）：${url}`,
      400,
      text.slice(0, 300),
      { url, status: String(response.status) },
    );
  }

  const entries = parseProviderModels(payload);
  if (entries.length === 0) {
    throw new AppError(
      ERROR_CODES.upstreamError,
      `上游响应里没有可识别的模型列表：${url}`,
      400,
      text.slice(0, 300),
      { url, status: String(response.status) },
    );
  }

  const configured = new Map((query.configuredModels ?? []).map((model) => [model.id, model]));
  const catalog = new Map((query.catalogModels ?? []).map((model) => [model.id, model]));
  const models: ProviderModelSuggestion[] = entries
    .slice(0, MAX_MODELS)
    .map((entry) => toSuggestion(entry, configured.get(entry.id), catalog.get(entry.id)));

  return {
    url,
    latencyMs: Date.now() - startedAt,
    models,
    truncated: entries.length > MAX_MODELS,
  };
};
