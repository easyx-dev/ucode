/** models 接口的响应模型 */
import type { RuntimeStatus } from "../runtime";

export type CatalogModel = {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
};

export type CatalogProvider = {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  /** 该 provider 是否已配置可用的鉴权 */
  available: boolean;
  models: CatalogModel[];
};

/** models/list 与 models/refresh 的返回 */
export type ModelsResponse = RuntimeStatus & {
  providers: CatalogProvider[];
};
