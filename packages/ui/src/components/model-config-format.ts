import type { ProviderSummary } from "@ucode/sdk";

/**
 * 模型配置窗口的**纯逻辑**：表单校验与文案。
 *
 * 拆出来的理由和别处一样：校验规则与"该说什么"可以脱离 DOM 单测，
 * 组件只负责把结果画出来。
 */

export type ProviderFormValues = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ProviderFormError = { field: "id" | "baseUrl" | "model"; message: string };

export const emptyProviderForm = (): ProviderFormValues => ({
  id: "",
  baseUrl: "",
  apiKey: "",
  model: "",
});

/**
 * 校验新增供应商的表单。
 *
 * `id` 允不允许点、`.` 和 `-`：它只是 `models.json` 里 providers 的键，宽松些无害。
 * **不允许空格**是硬要求——它会被当作 shell 参数或 URL 片段，后续很难查。
 */
export function validateProviderForm(values: ProviderFormValues): ProviderFormError | null {
  const id = values.id.trim();
  if (id === "") return { field: "id", message: "请填供应商 id（如 my-proxy）" };
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    return { field: "id", message: "供应商 id 只能用字母、数字、点、下划线、连字符" };
  }
  const baseUrl = values.baseUrl.trim();
  if (baseUrl === "") return { field: "baseUrl", message: "请填端点地址（OpenAI 兼容的 /v1）" };
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { field: "baseUrl", message: "端点地址不是合法 URL（要带 http:// 或 https://）" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { field: "baseUrl", message: "端点只支持 http / https" };
  }
  if (values.model.trim() === "")
    return { field: "model", message: "请填模型 id（如 gpt-4o-mini）" };
  return null;
}

/**
 * 一条供应商的摘要行：`id · 端点 · 有/无密钥`。
 *
 * 密钥永远是"有/无"，不是它的值——这条线在协议层就划好了，界面不越线。
 */
export function providerSummaryLine(provider: ProviderSummary): string {
  const key = provider.hasApiKey ? "有密钥" : "无密钥";
  return `${provider.id} · ${provider.baseUrl || "（未填端点）"} · ${key}`;
}

/**
 * 声明与基座解析结果不一致时的说明（列表里也要看得见，不只在新加的那一次）。
 *
 * 不一致的后果是"请求发到一个端点不认识的模型上"，而用户看到的只是"没有回复"——
 * 所以这条必须常驻可见，而不是一次性的提示。
 */
export function providerDriftNotice(provider: ProviderSummary): string | null {
  const resolved = provider.models.map((model) => model.id);
  const missing = provider.declared.filter((id) => !resolved.includes(id));
  const extra = resolved.filter((id) => !provider.declared.includes(id));
  if (missing.length === 0 && extra.length === 0) return null;
  return (
    `实际可用模型与声明不一致：${resolved.join("、") || "（无）"}。` +
    `这类 id 常与基座内置供应商同名，换个 id 重新添加即可。`
  );
}
