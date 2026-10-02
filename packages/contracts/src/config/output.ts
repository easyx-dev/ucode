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
