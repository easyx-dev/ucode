/** /api/v1/config：读取、更新（热重载）、连通性测试 */
import {
  appConfigPatchSchema,
  type ConfigSnapshot,
  type ConfigTestInput,
  type ConfigTestResponse,
  configTestSchema,
  ERROR_CODES,
  emptyInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";

import type { Services } from "../../app";
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
    throw new AppError(ERROR_CODES.upstreamUnreachable, `无法连接 ${url}`, 400, String(error));
  }

  const text = await response.text();
  if (!response.ok) {
    throw new AppError(
      ERROR_CODES.upstreamError,
      `上游返回 HTTP ${response.status}`,
      400,
      text.slice(0, 800),
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

  return router;
};
