import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StorePaths } from "@ucode/data-layer-spec";

/**
 * 供应商与模型定义（协议 D 的"配置"类，spec §3.2）。
 *
 * 沿用基座的 `models.json` 约定——因此 `PI_CODING_AGENT_DIR=<数据层>` 时 pi 生态读到的是同一份定义。
 * 写非追加内容走"临时文件 + rename"（spec §3.4 第 2 条：非追加写必须原子）。
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
  paths: StorePaths,
  providerId: string,
  config: ProviderConfigInput,
): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(paths.models, "utf8")) as Record<string, unknown>;
  } catch {
    existing = {};
  }
  const providers = { ...((existing.providers ?? {}) as Record<string, unknown>) };
  providers[providerId] = { api: "openai-completions", ...config };
  const next = { ...existing, providers };

  await mkdir(dirname(paths.models), { recursive: true, mode: 0o700 });
  const tmp = `${paths.models}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(tmp, paths.models);
}

export async function readProviderConfig(paths: StorePaths): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(paths.models, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
