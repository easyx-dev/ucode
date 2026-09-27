import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { servicePaths } from "../../paths.ts";
/**
 * 插件资源发现（F-3.5）。
 *
 * 插件的**加载**由基座的 `DefaultResourceLoader` 负责（`agentDir/extensions|skills|prompts|themes`
 * 已被自动发现）——服务层不需要自己实现加载器，只需要**发现并汇报**：控制层要能列出"这台机器
 * 上装了哪些扩展/技能/提示模板/主题"，否则用户无从知道自己有什么。
 *
 * 这条"资源目录即插件"的路径与 pi 生态完全一致，因此社区里现成的 pi 包（扩展/技能/提示模板）
 * 放进数据层对应目录即可生效，无需转换。
 */

export type ResourceKind = "extension" | "skill" | "prompt" | "theme";

export type DiscoveredResource = {
  kind: ResourceKind;
  /** 展示名（扩展/技能用目录名，提示模板/主题用文件名去扩展名）。 */
  name: string;
  /** 绝对路径。 */
  path: string;
  /** 是单文件还是目录（目录形态的扩展/技能带 index / SKILL.md）。 */
  entry: "file" | "directory";
};

const EXTENSION_EXTS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const PROMPT_EXTS = new Set([".md", ".markdown"]);
const THEME_EXTS = new Set([".json"]);

export async function discoverResources(dataDir: string): Promise<DiscoveredResource[]> {
  const paths = servicePaths(dataDir);
  const found: DiscoveredResource[] = [];
  found.push(...(await scanExtensions(paths.extensions)));
  found.push(...(await scanSkills(paths.skills)));
  found.push(...(await scanFlat(paths.prompts, "prompt", PROMPT_EXTS)));
  found.push(...(await scanFlat(paths.themes, "theme", THEME_EXTS)));
  return found.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

async function scanExtensions(dir: string): Promise<DiscoveredResource[]> {
  const entries = await safeReaddir(dir);
  const out: DiscoveredResource[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // 目录形态：pi 需要其中的 index.ts / index.js
      if (await hasEntryFile(full)) {
        out.push({ kind: "extension", name: entry.name, path: full, entry: "directory" });
      }
      continue;
    }
    if (EXTENSION_EXTS.has(extname(entry.name))) {
      out.push({
        kind: "extension",
        name: basename(entry.name, extname(entry.name)),
        path: full,
        entry: "file",
      });
    }
  }
  return out;
}

async function scanSkills(dir: string): Promise<DiscoveredResource[]> {
  const entries = await safeReaddir(dir);
  const out: DiscoveredResource[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await fileExists(join(full, "SKILL.md"))) {
        out.push({ kind: "skill", name: entry.name, path: full, entry: "directory" });
      }
      continue;
    }
    if (entry.name.endsWith(".md")) {
      out.push({
        kind: "skill",
        name: basename(entry.name, ".md"),
        path: full,
        entry: "file",
      });
    }
  }
  return out;
}

async function scanFlat(
  dir: string,
  kind: "prompt" | "theme",
  extensions: Set<string>,
): Promise<DiscoveredResource[]> {
  const entries = await safeReaddir(dir);
  return entries
    .filter((entry) => entry.isFile() && extensions.has(extname(entry.name)))
    .map((entry) => ({
      kind,
      name: basename(entry.name, extname(entry.name)),
      path: join(dir, entry.name),
      entry: "file" as const,
    }));
}

async function safeReaddir(dir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function hasEntryFile(dir: string): Promise<boolean> {
  return (await fileExists(join(dir, "index.ts"))) || (await fileExists(join(dir, "index.js")));
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
