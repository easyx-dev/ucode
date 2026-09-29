/** config 接口的响应模型，apiKey 已脱敏 */
import type { ApiType, ThinkingLevel } from "../constants";
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

export type ConfigView = {
  defaultModel: string | null;
  thinkingLevel: ThinkingLevel;
  providers: ProviderConfigView[];
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
