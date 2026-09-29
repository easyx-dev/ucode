/** models 接口的响应模型：pi 的供应商目录 + 应用已配置的条目 */
import type { RuntimeStatus } from "../runtime";

/**
 * 目录里的模型摘要：供列表展示与默认模型选择使用。
 * 未接入的内置供应商只给 `id` / `name` / `reasoning`——内置目录动辄上百个模型，
 * 完整参数（上下文窗口、输出上限）只对已接入的供应商下发，也正好是聊天区模型选择器要的。
 */
export type CatalogModel = {
  id: string;
  name: string;
  reasoning: boolean;
  /** 仅已接入的供应商提供 */
  contextWindow?: number;
  /** 仅已接入的供应商提供 */
  maxTokens?: number;
};

/** builtin = 来自 pi 内置目录；custom = 用户在配置里自定义 */
export type CatalogProviderSource = "builtin" | "custom";

export type CatalogProvider = {
  id: string;
  name: string;
  /** 内置目录里可能没有固定端点（这类 provider 不参与一键接入） */
  baseUrl: string | null;
  api: string;
  source: CatalogProviderSource;
  /** 该 provider 是否已配置可用的鉴权 */
  available: boolean;
  /** 鉴权来源：stored / runtime / environment / fallback；未配置时为 null */
  authSource: string | null;
  /** 鉴权说明文案，如 "DeepSeek API key" */
  authName: string;
  /** 用户是否覆盖了模型清单（覆盖后该 provider 不再跟随内置目录更新） */
  customized: boolean;
  models: CatalogModel[];
};

/** models/list 与 models/refresh 的返回 */
export type ModelsResponse = RuntimeStatus & {
  providers: CatalogProvider[];
};
