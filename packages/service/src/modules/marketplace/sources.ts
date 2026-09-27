import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { servicePaths } from "../../paths.ts";
import { writeFileAtomic } from "../../storage/index.ts";
/**
 * 市场源注册表（F-3.6）。
 *
 * 一个"源"就是**一个能列出可装插件的地方**，两种形态：
 * - `local`：本机目录（每个子目录是一个插件）；
 * - `remote`：一个返回 JSON 清单的地址（清单里给每个组件文件的具体 URL）。
 *
 * 刻意不做"官方市场"：源由用户登记、清单是纯数据（JSON），因此没有一条"信任第三方代码"的
 * 隐性通道被我们打开——装什么、从哪装，是用户显式登记的。
 */

export type MarketplaceSourceKind = "local" | "remote";

export type MarketplaceSource = {
  name: string;
  kind: MarketplaceSourceKind;
  /** local 是目录路径；remote 是清单地址（http/https）。 */
  location: string;
  description?: string;
};

export function marketplacesFileFor(dataDir: string): string {
  return join(servicePaths(dataDir).dataDir, "marketplaces.json");
}

export function normalizeSource(input: MarketplaceSource): MarketplaceSource {
  const name = input.name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u.test(name)) {
    throw new Error(`非法的源名 ${input.name}（只允许字母/数字/._-）。`);
  }
  const location = input.location.trim();
  if (location === "") throw new Error("源需要 location。");
  if (input.kind === "remote" && !/^https?:\/\//iu.test(location)) {
    throw new Error(`remote 源必须是 http(s) 地址：${location}`);
  }
  const source: MarketplaceSource = { name, kind: input.kind, location };
  if (input.description !== undefined && input.description !== "") {
    source.description = input.description;
  }
  return source;
}

export async function listSources(dataDir: string): Promise<MarketplaceSource[]> {
  let raw: string;
  try {
    raw = await readFile(marketplacesFileFor(dataDir), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { sources?: unknown };
    if (!Array.isArray(parsed.sources)) return [];
    return parsed.sources
      .filter((item): item is MarketplaceSource => {
        if (typeof item !== "object" || item === null) return false;
        const value = item as Record<string, unknown>;
        return (
          typeof value.name === "string" &&
          typeof value.location === "string" &&
          (value.kind === "local" || value.kind === "remote")
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function findSource(
  dataDir: string,
  name: string,
): Promise<MarketplaceSource | undefined> {
  return (await listSources(dataDir)).find((source) => source.name === name);
}

export async function addSource(
  dataDir: string,
  input: MarketplaceSource,
): Promise<MarketplaceSource> {
  const source = normalizeSource(input);
  const sources = await listSources(dataDir);
  await writeSources(dataDir, [...sources.filter((item) => item.name !== source.name), source]);
  return source;
}

export async function removeSource(dataDir: string, name: string): Promise<boolean> {
  const sources = await listSources(dataDir);
  const next = sources.filter((source) => source.name !== name);
  if (next.length === sources.length) return false;
  await writeSources(dataDir, next);
  return true;
}

async function writeSources(dataDir: string, sources: MarketplaceSource[]): Promise<void> {
  await writeFileAtomic(marketplacesFileFor(dataDir), JSON.stringify({ sources }, null, 2), {
    mode: 0o600,
  });
}
