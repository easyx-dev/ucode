import { join } from "node:path";
import { getBrand } from "@ucode/branding";
import { configureProvider, listAvailableModels } from "@ucode/core";
import { log } from "../runtime.ts";

/**
 * `provider` —— 本地供应商配置（F-5.3 模型凭据存储的第一版）。
 *
 * 权威性在本地：配置写进数据层的 `models.json`（与基座约定一致），因此
 * `PI_CODING_AGENT_DIR=<数据层>` 时 pi 生态看到的是同一份定义。
 * **密钥只写文件，不入库**；数据层目录本身是 0700。
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
  await configureProvider(options.dataDir, options.id, {
    baseUrl: options.baseUrl,
    api: options.api,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    models: [{ id: options.model, name: options.model, input: ["text"] }],
  });
  log(`已写入供应商配置：${join(options.dataDir, "models.json")}`);
  log(`  供应商 ${options.id} · 端点 ${options.baseUrl} · 模型 ${options.model}`);
  log(`  下一步：${getBrand().productName} web  或  ${getBrand().productName} tui`);
  return 0;
}

export async function runProviderList(options: ProviderListOptions): Promise<number> {
  const models = await listAvailableModels(options.dataDir);
  if (models.length === 0) {
    log("还没有可用的模型。用 `provider add` 配一个：");
    log(
      `  ${getBrand().productName} provider add --base-url <OpenAI 兼容端点> --model <模型名> --api-key <密钥>`,
    );
    return 1;
  }
  for (const model of models) log(`${model.provider}/${model.modelId}  ${model.name}`);
  return 0;
}
