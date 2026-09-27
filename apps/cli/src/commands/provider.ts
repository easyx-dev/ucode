import { join } from "node:path";
import { getBrand } from "@ucode/branding";
import {
  addProviderConfig,
  listAvailableModels,
  listProviderSummaries,
  servicePaths,
} from "@ucode/service";
import { log } from "../runtime.ts";

/**
 * `provider` —— 本地供应商配置（F-5.3）。
 *
 * 权威性在本地：配置写进数据层的 `models.json`（与基座约定一致），因此
 * `PI_CODING_AGENT_DIR=<数据层>` 时 pi 生态看到的是同一份定义。
 * **密钥只写文件，不当返回值**；数据层目录本身是 0700。
 */

export type ProviderAddOptions = {
  dataDir: string;
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  api: string;
};

export type ProviderListOptions = { dataDir: string };

export async function runProviderAdd(options: ProviderAddOptions): Promise<number> {
  const outcome = await addProviderConfig(options.dataDir, {
    id: options.id,
    baseUrl: options.baseUrl,
    api: options.api,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    models: [{ id: options.model, name: options.model, input: ["text"] }],
    makeDefault: true,
  });
  log(`已写入供应商配置：${servicePaths(options.dataDir).models}`);
  log(
    `  供应商 ${options.id} · 端点 ${options.baseUrl} · 模型 ${options.model}` +
      (outcome.created ? "" : "（已存在，已覆盖）"),
  );
  // 声明与基座解析不一致时**必须说出来**：否则用户只会看到"发出去没反应"。
  if (outcome.warning !== null) log(`  ⚠ ${outcome.warning}`);
  log(`  下一步：${getBrand().productName} web  或  ${getBrand().productName} tui`);
  return 0;
}

export async function runProviderList(options: ProviderListOptions): Promise<number> {
  const { providers } = await listProviderSummaries(options.dataDir);
  const models = await listAvailableModels(options.dataDir);
  if (models.length === 0) {
    log("还没有可用的模型。用 `provider add` 配一个：");
    log(
      `  ${getBrand().productName} provider add --base-url <OpenAI 兼容端点> --model <模型名> --api-key <密钥>`,
    );
    return 1;
  }
  for (const provider of providers) {
    log(
      `${provider.id}  ${provider.baseUrl}  ${provider.hasApiKey ? "有密钥" : "无密钥"}` +
        `  模型 ${provider.models.map((model) => model.id).join("、")}`,
    );
  }
  log("可用模型：");
  for (const model of models) log(`  ${model.provider}/${model.modelId}  ${model.name}`);
  return 0;
}
