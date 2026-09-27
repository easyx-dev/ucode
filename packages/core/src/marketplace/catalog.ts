import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MarketplaceSource } from "./sources.ts";

/**
 * 市场目录（F-3.6）：把源读成一组"可装的条目"。
 *
 * 插件清单是**纯数据**，且**显式列出每个组件文件**（而不是让我们猜目录结构）：
 * 装什么、装到哪，由清单说清楚，安装器不需要启发式——这正是"装的东西可预期"的前提。
 *
 * 清单形状（`plugin.json` 或 remote 清单里的一个条目）：
 * ```json
 * { "name": "demo", "version": "1.0.0", "description": "…",
 *   "components": {
 *     "skills":  [{ "name": "pdf",   "file": "skills/pdf/SKILL.md" }],
 *     "prompts": [{ "name": "review", "file": "commands/review.md" }],
 *     "agents":  [{ "name": "helper", "file": "agents/helper.md" }],
 *     "extensions": [{ "name": "echo", "file": "extensions/echo.ts" }]
 *   } }
 * ```
 * remote 清单里组件用 `url` 代替 `file`（逐个文件给 URL，不引入压缩包格式）。
 */

export type PluginComponentKind = "skill" | "prompt" | "agent" | "extension";

export type PluginComponent = {
  kind: PluginComponentKind;
  name: string;
  /** 本地源的相对路径。 */
  file?: string;
  /** 远程源的绝对 URL。 */
  url?: string;
};

export type CatalogEntry = {
  name: string;
  version?: string;
  description?: string;
  /** 来自哪个源（名字）。 */
  source: string;
  components: PluginComponent[];
};

/** 组件类别 → 清单里的键（清单用复数，读起来更像"一组技能"）。 */
const COMPONENT_KEYS: { kind: PluginComponentKind; key: string }[] = [
  { kind: "skill", key: "skills" },
  { kind: "prompt", key: "prompts" },
  { kind: "agent", key: "agents" },
  { kind: "extension", key: "extensions" },
];

/** 读一个源的目录。远程源按清单读，本地源扫子目录。 */
export async function readCatalog(
  source: MarketplaceSource,
  options: { fetchJson?: (url: string) => Promise<unknown> } = {},
): Promise<CatalogEntry[]> {
  if (source.kind === "remote") {
    const fetchJson = options.fetchJson ?? defaultFetchJson;
    const manifest = (await fetchJson(source.location)) as { plugins?: unknown };
    const plugins = Array.isArray(manifest.plugins) ? manifest.plugins : [];
    return plugins
      .map((item) => parseEntry(item, source.name))
      .filter((entry): entry is CatalogEntry => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  let names: string[];
  try {
    names = await readdir(source.location, { withFileTypes: true }).then((entries) =>
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    );
  } catch {
    return [];
  }
  const out: CatalogEntry[] = [];
  for (const name of names) {
    try {
      const raw = JSON.parse(await readFile(join(source.location, name, "plugin.json"), "utf8"));
      const entry = parseEntry(raw, source.name);
      if (entry !== null) out.push(entry);
    } catch {
      // 没有 plugin.json（或不是合法清单）：跳过，不当成插件
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseEntry(raw: unknown, sourceName: string): CatalogEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  const componentsRaw = value.components;
  const components: PluginComponent[] = [];
  if (typeof componentsRaw === "object" && componentsRaw !== null) {
    for (const { kind, key } of COMPONENT_KEYS) {
      const list = (componentsRaw as Record<string, unknown>)[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item !== "object" || item === null) continue;
        const component = item as Record<string, unknown>;
        if (typeof component.name !== "string") continue;
        const file = typeof component.file === "string" ? component.file : undefined;
        const url = typeof component.url === "string" ? component.url : undefined;
        if (file === undefined && url === undefined) continue;
        components.push({
          kind,
          name: component.name,
          ...(file === undefined ? {} : { file }),
          ...(url === undefined ? {} : { url }),
        });
      }
    }
  }
  const entry: CatalogEntry = { name: value.name, source: sourceName, components };
  if (typeof value.version === "string") entry.version = value.version;
  if (typeof value.description === "string") entry.description = value.description;
  return entry;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`读取清单失败（HTTP ${response.status}）：${url}`);
  return response.json();
}
