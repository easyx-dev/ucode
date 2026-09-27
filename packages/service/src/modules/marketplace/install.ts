import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { servicePaths } from "../../paths.ts";
import { writeFileAtomic } from "../../storage/index.ts";
import { withProvenance } from "../import/apply.ts";
import { type DiscoveredResource, discoverResources } from "../plugins/discovery.ts";
import type { CatalogEntry, PluginComponent, PluginComponentKind } from "./catalog.ts";
import type { MarketplaceSource } from "./sources.ts";

/**
 * 插件的安装与卸载（F-3.6）。
 *
 * 安装 = 把清单列出的组件文件**落到数据层对应位置**（技能→`skills/<name>/SKILL.md`、
 * 提示→`prompts/<name>.md`、子智能体→`agents/<name>.md`、扩展→`extensions/<name>.ts`），
 * 并给 Markdown 写上 `importedFrom` 来源——装进来的东西要能一眼看出从哪来。
 *
 * **不静默覆盖**：目标已存在默认跳过（用户可能自己改过）；要覆盖得显式说。
 * **卸载只删自己装的**：按组件类型与名字删对应文件/目录，不动别的东西。
 *
 * 注意：`extensions/*.ts` 是**可执行代码**，装它等于信任该来源——所以源必须由用户登记，
 * 且安装动作受批准门槛约束（协议里是 `sessions.write`）。
 */

export type InstallOptions = {
  dataDir: string;
  source: MarketplaceSource;
  entry: CatalogEntry;
  overwrite?: boolean;
  /** 远程组件取内容（本地组件直接读文件）。 */
  fetchText?: (url: string) => Promise<string>;
};

export type InstallReport = {
  installed: { kind: PluginComponentKind; name: string; to: string }[];
  skipped: { kind: PluginComponentKind; name: string; to: string; reason: "exists" }[];
  failed: { kind: PluginComponentKind; name: string; reason: string }[];
};

export async function installPlugin(options: InstallOptions): Promise<InstallReport> {
  const report: InstallReport = { installed: [], skipped: [], failed: [] };
  const fetchText = options.fetchText ?? defaultFetchText;

  for (const component of options.entry.components) {
    const destination = marketplaceDestinationFor(options.dataDir, component);
    if (!options.overwrite && (await exists(destination))) {
      report.skipped.push({
        kind: component.kind,
        name: component.name,
        to: destination,
        reason: "exists",
      });
      continue;
    }
    let content: string;
    try {
      content = await readComponent(options, component, fetchText);
    } catch (error) {
      report.failed.push({
        kind: component.kind,
        name: component.name,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const body =
      component.kind === "extension"
        ? content
        : withProvenance(content, {
            origin: "generic",
            relativePath: `${options.source.name}/${options.entry.name}/${component.file ?? component.url ?? ""}`,
          });
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFileAtomic(destination, body, { mode: 0o600 });
    report.installed.push({ kind: component.kind, name: component.name, to: destination });
  }

  return report;
}

/** 卸载：只删这个组件对应的路径（技能是目录，其余是文件）。 */
export async function uninstallPlugin(input: {
  dataDir: string;
  kind: PluginComponentKind;
  name: string;
}): Promise<{ removed: boolean; path: string }> {
  const paths = servicePaths(input.dataDir);
  const target =
    input.kind === "skill"
      ? join(paths.skills, input.name)
      : input.kind === "prompt"
        ? join(paths.prompts, `${input.name}.md`)
        : input.kind === "agent"
          ? join(paths.agents, `${input.name}.md`)
          : join(paths.extensions, input.name);

  const candidates =
    input.kind === "extension"
      ? [`${target}.ts`, `${target}.js`, `${target}.mjs`, target]
      : [target];

  let removed = false;
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    await rm(candidate, { recursive: true, force: true });
    removed = true;
  }
  return { removed, path: target };
}

/** 已装资源（复用插件发现：数据层里有什么就是装了什么）。 */
export async function listInstalled(dataDir: string): Promise<DiscoveredResource[]> {
  return discoverResources(dataDir);
}

export function marketplaceDestinationFor(dataDir: string, component: PluginComponent): string {
  const paths = servicePaths(dataDir);
  switch (component.kind) {
    case "skill":
      return join(paths.skills, component.name, "SKILL.md");
    case "prompt":
      return join(paths.prompts, `${component.name}.md`);
    case "agent":
      return join(paths.agents, `${component.name}.md`);
    case "extension": {
      const source = component.file ?? component.url ?? "";
      const suffix = source.endsWith(".js") || source.endsWith(".mjs") ? ".js" : ".ts";
      return join(paths.extensions, `${component.name}${suffix}`);
    }
  }
}

async function readComponent(
  options: InstallOptions,
  component: PluginComponent,
  fetchText: (url: string) => Promise<string>,
): Promise<string> {
  if (component.url !== undefined) return fetchText(component.url);
  if (component.file === undefined) throw new Error("组件既没有 file 也没有 url。");
  const base =
    options.source.kind === "local" ? join(options.source.location, options.entry.name) : "";
  return readFile(join(base, component.file), "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
  return response.text();
}

/** 一行摘要（工具/日志用）。 */
export function summarizeInstall(report: InstallReport): string {
  const parts = [`装好 ${report.installed.length} 项`];
  if (report.skipped.length > 0) parts.push(`跳过 ${report.skipped.length} 项（已存在）`);
  if (report.failed.length > 0) parts.push(`失败 ${report.failed.length} 项`);
  return `${parts.join("；")}。`;
}
