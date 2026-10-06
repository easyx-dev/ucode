/** config 接口的响应模型，apiKey 已脱敏 */
import type { ApiType, SearchProviderId, ThinkingLevel } from "../constants";
import type { RuntimeStatus } from "../runtime";

import type { ProviderModel } from "./input";

export type ProviderModelView = ProviderModel;

export type ProviderConfigView = {
  id: string;
  name: string;
  /** 留空表示继承 pi 内置目录的同名 provider */
  baseUrl?: string;
  api: ApiType;
  /** 脱敏后的 key，仅用于回显「已保存」 */
  apiKeyMasked: string;
  /** 留空表示模型清单继承 pi 内置目录 */
  models?: ProviderModelView[];
};

/** 联网搜索设置视图：apiKey 已脱敏，未配置时 `apiKeyMasked` 为空串 */
export type WebsearchView = {
  provider: SearchProviderId;
  apiKeyMasked: string;
  /** 自建 SearXNG 的实例地址；其他 provider 恒为空串 */
  baseUrl: string;
  /** 该 provider 的前置条件是否齐备（key 或实例地址）；决定 websearch 工具是否可用 */
  configured: boolean;
};

/** 项目级记忆设置视图：只有开关，记忆内容按项目落在服务端磁盘上 */
export type MemoryView = {
  enabled: boolean;
};

export type ConfigView = {
  defaultModel: string | null;
  thinkingLevel: ThinkingLevel;
  providers: ProviderConfigView[];
  websearch: WebsearchView;
  memory: MemoryView;
};

/** config/info 与 config/update 的返回：配置视图 + 运行时状态 */
export type ConfigSnapshot = {
  config: ConfigView;
  status: RuntimeStatus;
};

/** config/test 的返回 */
export type ConfigTestResponse = {
  /** 上游响应耗时 */
  latencyMs: number;
  /** 上游回显的模型 id，未回显时为 null */
  modelEcho: string | null;
  /** 实际请求的 chat/completions 地址 */
  url: string;
};

/**
 * 能力取值的来源，按优先级从高到低：
 * `configured` 命中当前配置里已保存的同 id 模型；`upstream` 上游条目自带元数据；
 * `catalog` 命中 pi 内置目录里的同 id 条目；`heuristic` 按模型 id 关键词推断；
 * `default` 无任何依据，取与 providerModelSchema 相同的保守默认值。
 *
 * 每条能力按上述顺序逐项补齐，标注的是**最高命中层**（同一层可能只给出部分字段）。
 */
export type ModelCapabilitySource = "configured" | "upstream" | "catalog" | "heuristic" | "default";

/**
 * 拉取到的模型条目：能力字段已尽量补全，设置页可直接落成 `ProviderModel`。
 * 上游只保证给得出 id，因此除 id 以外的字段都带推断成分，`capabilitySource` 用来说明可信度。
 */
export type ProviderModelSuggestion = {
  id: string;
  /** 上游给出的展示名，没给则回落为 id */
  name: string;
  /** 是否支持思考（推断） */
  reasoning: boolean;
  /** 是否接受图片输入（推断） */
  vision: boolean;
  /** 上下文窗口（推断） */
  contextWindow: number;
  /** 单次输出上限（推断） */
  maxTokens: number;
  /** 上述能力的取值来源 */
  capabilitySource: ModelCapabilitySource;
  /** 是否已存在于该 provider 的配置里（按 id 比对） */
  configured: boolean;
};

/** config/fetch-models 的返回 */
export type ProviderModelsResponse = {
  /** 实际请求的 `/models` 地址 */
  url: string;
  /** 上游响应耗时 */
  latencyMs: number;
  models: ProviderModelSuggestion[];
  /** 上游返回条数超过上限，只回了前面一段 */
  truncated: boolean;
};
