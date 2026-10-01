/**
 * 本地网关运行时：`smoke` 与 `eval` 共用的「写 models.json + 注册 provider」装配。
 *
 * 两个脚本都要连同一个 OpenAI 兼容端点，装配方式必须一致，否则「评测通过但冒烟挂」
 * 之类的差异会浪费排查时间。模型未注册时返回 undefined，由调用方决定怎么报错退出。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type LocalGatewayOptions = {
  /** agent 数据目录：models.json / auth.json 落这里 */
  agentDir: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  providerId?: string;
};

export type LocalGateway = {
  modelRuntime: ModelRuntime;
  /** 目标模型；未注册时为 undefined */
  model: ReturnType<ModelRuntime["getModel"]>;
};

export const createLocalGateway = async ({
  agentDir,
  baseUrl,
  apiKey,
  modelId,
  providerId = "local",
}: LocalGatewayOptions): Promise<LocalGateway> => {
  mkdirSync(agentDir, { recursive: true });
  const modelsPath = resolve(agentDir, "models.json");
  writeFileSync(
    modelsPath,
    `${JSON.stringify(
      {
        providers: {
          [providerId]: {
            name: "Local Gateway",
            baseUrl,
            api: "openai-completions",
            apiKey,
            models: [
              {
                id: modelId,
                name: modelId,
                reasoning: true,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 8192,
                compat: { supportsDeveloperRole: false },
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const modelRuntime = await ModelRuntime.create({
    authPath: resolve(agentDir, "auth.json"),
    modelsPath,
    refreshOnCreate: false,
  });

  return { modelRuntime, model: modelRuntime.getModel(providerId, modelId) };
};
