/** /api/v1/config：读取、更新（热重载）、连通性测试、拉取可用模型 */
import {
  appConfigPatchSchema,
  type ConfigSnapshot,
  type ConfigTestInput,
  type ConfigTestResponse,
  configTestSchema,
  ERROR_CODES,
  emptyInputSchema,
  type ProviderModelsInput,
  type ProviderModelsResponse,
  providerModelsInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
import { fetchProviderModels } from "../../config/provider-models";
import { publicConfig } from "../../config/store";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";

const testConnection = async (
  input: ConfigTestInput,
  services: Services,
): Promise<ConfigTestResponse> => {
  if (input.api !== "openai-completions") {
    throw new AppError(
      ERROR_CODES.unsupportedApi,
      `连通性测试目前只支持 openai-completions，当前为 ${input.api}`,
      400,
      undefined,
      { api: input.api },
    );
  }

  const apiKey =
    input.apiKey?.trim() ||
    services.config.get().providers.find((item) => item.id === input.providerId)?.apiKey;

  if (!apiKey) {
    throw new AppError(
      ERROR_CODES.invalidRequest,
      "缺少 apiKey（未保存过该 provider 的 key）",
      400,
    );
  }

  const url = `${input.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AppError(ERROR_CODES.upstreamUnreachable, `无法连接 ${url}`, 400, String(error), {
      url,
    });
  }

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(
      ERROR_CODES.upstreamError,
      `上游返回 HTTP ${response.status}`,
      400,
      text.slice(0, 800),
      { status: String(response.status) },
    );
  }

  let modelEcho: string | null = null;
  try {
    const parsed = JSON.parse(text) as { model?: unknown };
    modelEcho = typeof parsed.model === "string" ? parsed.model : null;
  } catch {
    // 解析失败不影响连通性结论
  }

  return { latencyMs: Date.now() - startedAt, modelEcho, url };
};

/**
 * 按 provider 端点拉模型列表。apiKey 允许留空（key 还没填进表单、但配置里存过），
 * 已保存的同 id 模型作为能力推断的最高优先级来源一并发给解析层。
 */
const fetchModels = async (
  input: ProviderModelsInput,
  services: Services,
): Promise<ProviderModelsResponse> => {
  const provider = services.config.get().providers.find((item) => item.id === input.providerId);
  const apiKey = input.apiKey?.trim() || provider?.apiKey;

  if (!apiKey) {
    throw new AppError(
      ERROR_CODES.invalidRequest,
      "缺少 apiKey（未保存过该 provider 的 key）",
      400,
    );
  }

  return fetchProviderModels({
    baseUrl: input.baseUrl,
    apiKey,
    api: input.api,
    configuredModels: provider?.models,
    // 内置目录只列出「已接入」的 provider，未保存过的新 provider 拿不到线索
    catalogModels: services.runtime.getCatalog().find((item) => item.id === input.providerId)
      ?.models,
  });
};

export const createConfigRoute = (services: Services) => {
  const router = new Hono();

  const snapshot = (): ConfigSnapshot => ({
    config: publicConfig(services.config.get()),
    status: services.runtime.getStatus(),
  });

  router.post("/info", jsonBody(emptyInputSchema), (c) => c.json(ok(snapshot())));

  router.post("/update", jsonBody(appConfigPatchSchema), async (c) => {
    await services.applyConfig(c.req.valid("json"));
    return c.json(ok(snapshot()));
  });

  router.post("/test", jsonBody(configTestSchema), async (c) => {
    return c.json(ok(await testConnection(c.req.valid("json"), services)));
  });

  router.post("/fetch-models", jsonBody(providerModelsInputSchema), async (c) => {
    return c.json(ok(await fetchModels(c.req.valid("json"), services)));
  });

  return router;
};
