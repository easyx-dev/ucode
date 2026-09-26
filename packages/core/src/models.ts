import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { StorePaths } from "@ucode/data-layer-spec";

/**
 * 模型与供应商（spec §3.2 的"配置"、§4.4 的配置类命令）。
 *
 * 权威性逐模型：用户自配的模型由本地权威（写在数据层的 `models.json` / `settings.json`），
 * uhub 提供的模型由 uhub 权威——后者属后续版本，这里只保证"本地配置是唯一来源"。
 */

export type ModelSummary = {
  provider: string;
  modelId: string;
  name: string;
  /** 是否具备可用凭据/端点。 */
  available: boolean;
};

export async function createModelRuntime(paths: StorePaths): Promise<ModelRuntime> {
  return ModelRuntime.create({
    modelsPath: paths.models,
    authPath: paths.auth,
  });
}

export async function listModels(modelRuntime: ModelRuntime): Promise<ModelSummary[]> {
  const available = await modelRuntime.getAvailable();
  return available.map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name ?? model.id,
    available: true,
  }));
}

/**
 * 写入一份供应商配置（供 CLI/桌面壳在首次运行时落地本地供应商，以及测试注入假供应商）。
 * 走临时文件 + rename：非追加写必须原子（spec §3.4 第 2 条）。
 */
export async function writeProviderConfig(
  paths: StorePaths,
  providerId: string,
  config: {
    baseUrl: string;
    api?: string;
    apiKey?: string;
    models: {
      id: string;
      name?: string;
      input?: string[];
      contextWindow?: number;
      maxTokens?: number;
    }[];
  },
): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(paths.models, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const providers = (existing.providers ?? {}) as Record<string, unknown>;
  providers[providerId] = { api: "openai-completions", ...config };
  const next = { ...existing, providers };

  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });
  const tmp = `${paths.models}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  const { rename } = await import("node:fs/promises");
  await rename(tmp, paths.models);
}
