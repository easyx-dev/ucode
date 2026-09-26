import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { StorePaths } from "@ucode/data-layer-spec";
import { openStore, type ProviderConfigInput, writeProviderConfig } from "@ucode/store";

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
 * 写入一份供应商配置（控制层不直接改文件，一律经核心层：F-5.1）。
 *
 * 走 `openStore` 意味着同样经过数据层守卫（权限、危险文件系统、版本）——
 * 配置写入不是"绕过数据层"的捷径。
 */
export async function configureProvider(
  dataDir: string,
  providerId: string,
  config: ProviderConfigInput,
): Promise<void> {
  const store = await openStore({ dataDir });
  try {
    await writeProviderConfig(store.paths, providerId, config);
  } finally {
    await store.close();
  }
}

/** 列出当前可用的模型（需要初始化模型运行时，因此留在核心层）。 */
export async function listAvailableModels(dataDir: string): Promise<ModelSummary[]> {
  const store = await openStore({ dataDir });
  try {
    return await listModels(await createModelRuntime(store.paths));
  } finally {
    await store.close();
  }
}
