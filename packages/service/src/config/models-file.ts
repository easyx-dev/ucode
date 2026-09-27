import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** 只关心这两个位置：都在 pi 目录下——pi 生态要读同一份定义。 */
type ModelsPaths = { models: string; settings: string };

/**
 * 供应商与模型定义。
 *
 * 沿用基座的 `models.json` 约定——`PI_CODING_AGENT_DIR=<pi 目录>` 时 pi 生态读到的是同一份定义。
 * 非追加写走"临时文件 + rename"（原子）。
 */
export type ProviderModelConfig = {
  id: string;
  name?: string;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
};

export type ProviderConfigInput = {
  baseUrl: string;
  api?: string;
  apiKey?: string;
  models: ProviderModelConfig[];
};

export async function writeProviderConfig(
  paths: ModelsPaths,
  providerId: string,
  config: ProviderConfigInput,
): Promise<void> {
  const existing = await readProviderConfig(paths);
  const providers = { ...((existing.providers ?? {}) as Record<string, unknown>) };
  // 覆盖写时若没给新密钥，保留原来那把——否则"改一下模型列表"会把凭据抹掉。
  const previous = providers[providerId] as { apiKey?: unknown } | undefined;
  const apiKey =
    config.apiKey ?? (typeof previous?.apiKey === "string" ? previous.apiKey : undefined);
  providers[providerId] = {
    api: "openai-completions",
    ...config,
    ...(apiKey === undefined ? {} : { apiKey }),
  };
  const next = { ...existing, providers };
  await writeJsonAtomic(paths.models, next);
}

/** 删除一个供应商；返回它之前是否存在（调用方据此区分"删掉了"与"本来就没有"）。 */
export async function removeProviderConfig(
  paths: ModelsPaths,
  providerId: string,
): Promise<boolean> {
  const existing = await readProviderConfig(paths);
  const providers = { ...((existing.providers ?? {}) as Record<string, unknown>) };
  if (!Object.hasOwn(providers, providerId)) return false;
  delete providers[providerId];
  await writeJsonAtomic(paths.models, { ...existing, providers });
  return true;
}

/**
 * 写默认模型（`settings.json` 的 `defaultProvider` / `defaultModel`）。
 *
 * 与 `models.json` 分开：前者是"选哪个"，后者是"有哪些、怎么连"。
 * 合并写在一处会让"换默认模型"不得不重写凭据文件。
 */
export async function writeDefaultModel(
  paths: ModelsPaths,
  providerId: string,
  modelId: string,
): Promise<void> {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(paths.settings, "utf8")) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  await writeJsonAtomic(paths.settings, {
    ...settings,
    defaultProvider: providerId,
    defaultModel: modelId,
  });
}

export async function readProviderConfig(paths: ModelsPaths): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(paths.models, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 非追加写一律走"临时文件 + rename"（spec §3.4 第 2 条：非追加写必须原子）。 */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}
