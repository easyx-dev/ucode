import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderSummary } from "@ucode/protocol";
import type { ServicePaths } from "../paths.ts";
import { servicePaths } from "../paths.ts";
import {
  type ProviderConfigInput,
  type ProviderModelConfig,
  readProviderConfig,
  removeProviderConfig,
  writeDefaultModel,
  writeProviderConfig,
} from "./models-file.ts";
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

export async function createModelRuntime(paths: ServicePaths): Promise<ModelRuntime> {
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
 * 写入一份供应商配置（控制层不直接改文件，一律经服务层：F-5.1）。
 *
 * 走 `createServiceStore` 意味着同样经过数据层守卫（权限、危险文件系统、版本）——
 * 配置写入不是"绕过数据层"的捷径。
 */
export async function configureProvider(
  dataDir: string,
  providerId: string,
  config: ProviderConfigInput,
): Promise<void> {
  const paths = servicePaths(dataDir);
  await writeProviderConfig(paths, providerId, config);
}

/** 列出当前可用的模型（需要初始化模型运行时，因此留在服务层）。 */
export async function listAvailableModels(dataDir: string): Promise<ModelSummary[]> {
  const paths = servicePaths(dataDir);
  return await listModels(await createModelRuntime(paths));
}

// ── 供应商配置（F-5.3，供控制层的"模型配置窗口"用） ──

export type AddProviderInput = {
  id: string;
  baseUrl: string;
  api?: string;
  apiKey?: string;
  models: ProviderModelConfig[];
  makeDefault?: boolean;
};

export type AddProviderOutcome = {
  provider: ProviderSummary;
  created: boolean;
  /** 声明与基座解析结果不一致时的如实提示（`null` 表示没有差异）。 */
  warning: string | null;
};

/**
 * 读一份供应商清单。
 *
 * `models` 报的是**基座实际会用的**模型（`getModels(providerId)` 去掉无凭据的），
 * 而不是配置文件里那串：两者在 id 与基座内置供应商重名时并不一致，
 * 会话里真正能选到的也只有前者。声明的那串放在 `declared` 里，差异因此可见。
 */
export async function listProviderSummaries(dataDir: string): Promise<{
  providers: ProviderSummary[];
  configFile: string;
}> {
  const paths = servicePaths(dataDir);
  return await summarizeProviders(paths);
}

/** 打开着的 store 版本：写完之后要在**同一个**数据层句柄上立刻回读，不必再开一次。 */
async function summarizeProviders(paths: ServicePaths): Promise<{
  providers: ProviderSummary[];
  configFile: string;
}> {
  const raw = await readProviderConfig(paths);
  const declaredProviders = (raw.providers ?? {}) as Record<string, unknown>;

  let resolveModels: (providerId: string) => { id: string; name: string; available: boolean }[] =
    () => [];
  try {
    const runtime = await createModelRuntime(paths);
    const available = new Set(
      (await runtime.getAvailable()).map((model) => `${model.provider}/${model.id}`),
    );
    resolveModels = (providerId) =>
      runtime.getModels(providerId).map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        available: available.has(`${providerId}/${model.id}`),
      }));
  } catch {
    // 模型运行时初始化不了（缺凭据、文件损坏）不该让"看配置"这件事整个失败；
    // 这时 models 为空，界面据 declared 仍能显示写进去的配置。
    resolveModels = () => [];
  }

  const providers: ProviderSummary[] = Object.entries(declaredProviders).map(([id, value]) => {
    const config = (value ?? {}) as {
      baseUrl?: unknown;
      api?: unknown;
      apiKey?: unknown;
      models?: unknown;
    };
    const declaredModels = Array.isArray(config.models) ? config.models : [];
    const declared: string[] = [];
    for (const model of declaredModels) {
      const entry = (model ?? {}) as { id?: unknown };
      if (typeof entry.id === "string" && entry.id !== "") declared.push(entry.id);
    }
    return {
      id,
      baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "",
      api: typeof config.api === "string" ? config.api : "openai-completions",
      hasApiKey: typeof config.apiKey === "string" && config.apiKey !== "",
      models: resolveModels(id),
      declared,
    };
  });
  return { providers, configFile: paths.models };
}

/** 写入/覆盖一个供应商，并回报基座实际解析出来的模型。 */
export async function addProviderConfig(
  dataDir: string,
  input: AddProviderInput,
): Promise<AddProviderOutcome> {
  const paths = servicePaths(dataDir);
  const before = await readProviderConfig(paths);
  const created = !Object.hasOwn((before.providers ?? {}) as Record<string, unknown>, input.id);

  await writeProviderConfig(paths, input.id, {
    baseUrl: input.baseUrl,
    ...(input.api === undefined ? {} : { api: input.api }),
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    models: input.models,
  });
  if (input.makeDefault === true) {
    const first = input.models[0];
    if (first !== undefined) await writeDefaultModel(paths, input.id, first.id);
  }

  const { providers } = await summarizeProviders(paths);
  const summary: ProviderSummary = providers.find((candidate) => candidate.id === input.id) ?? {
    id: input.id,
    baseUrl: input.baseUrl,
    api: input.api ?? "openai-completions",
    hasApiKey: input.apiKey !== undefined,
    models: [],
    declared: input.models.map((model) => model.id),
  };

  return { provider: summary, created, warning: describeDrift(summary) };
}

/** 删除一个供应商。 */
export async function deleteProviderConfig(dataDir: string, providerId: string): Promise<boolean> {
  const paths = servicePaths(dataDir);
  return await removeProviderConfig(paths, providerId);
}

/**
 * 声明 → 解析的漂移检测。
 *
 * 判据是"基座解析出来的模型集合 ≠ 声明集合"：超集说明这个 id 落到了基座内置目录上
 * （内置模型被并进来），缺项说明声明的模型没被采纳。两种都会让用户以为配好的模型
 * 没生效，所以都要报。
 */
function describeDrift(resolved: ProviderSummary): string | null {
  if (resolved.declared.length === 0) return null;
  const resolvedIds = resolved.models.map((model) => model.id);
  const missing = resolved.declared.filter((id) => !resolvedIds.includes(id));
  const extra = resolvedIds.filter((id) => !resolved.declared.includes(id));
  if (missing.length === 0 && extra.length === 0) return null;

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`声明的 ${missing.join("、")} 没有被采纳`);
  if (extra.length > 0) parts.push(`多出了 ${extra.join("、")}`);
  return (
    `供应商 ${resolved.id} 的模型与声明不一致：${parts.join("；")}。` +
    `实际会用的是 ${resolvedIds.join("、") || "（无）"}。` +
    `常见原因是该 id 与基座内置供应商同名（内置目录会与之合并）——` +
    `换一个不重名的 id（例如 ${resolved.id}-custom）后重新添加即可。`
  );
}
