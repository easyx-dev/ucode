/**
 * 插件包内的组件解析：把清单声明与标准目录布局归成一张组件表，并挡住越界路径。
 *
 * 路径规则：相对插件根、必须以 `./` 开头（`skills` 另接受 `.` 指插件根），归一化后必须仍在根内，
 * 经符号链接逃出根同样拒绝——越界即拒绝该组件并出诊断，不因为一个组件坏掉就丢掉整包。
 *
 * 「默认路径缺失」与「声明路径缺失」要分开：前者是常态（插件可以没有 hooks、没有 agents），
 * 后者是作者的错，只有后者出诊断。
 */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  ERROR_CODES,
  type PluginComponentGroup,
  type PluginDiagnosticView,
} from "@ucode/contracts";

import { MARKDOWN_EXTENSION, SKILL_FILENAME } from "../../constants/dirs";
import {
  PLUGIN_BIN_COMPONENT_PATH,
  PLUGIN_COMPONENT_DEFAULT_PATHS,
  PLUGIN_COMPONENT_SCAN_MAX_DEPTH,
  PLUGIN_HOOKS_COMPONENT_PATH,
  PLUGIN_MCP_COMPONENT_PATH,
} from "../../constants/plugins";
import { isInsidePath, toPosixPath } from "../../platform/paths";
import { AppError } from "../../platform/response";
import { describeError, diagnostic } from "./diagnostic";
import type { PluginManifest } from "./manifest";
import type { PluginAssetDirs, PluginComponentEntry } from "./types";

export type PluginComponents = {
  entries: PluginComponentEntry[];
  /** 装配期注入用的目录；与逐条组件分开收，loader 要的是目录而不是每个组件 */
  assets: PluginAssetDirs;
  diagnostics: PluginDiagnosticView[];
};

/** 一条待解析的组件路径：`declared` 区分清单显式声明与默认布局 */
type ComponentPathSpec = {
  raw: string;
  declared: boolean;
};

type ComponentContext = {
  root: string;
  diagnostics: PluginDiagnosticView[];
  assets: PluginAssetDirs;
};

export const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const realpathOf = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/** 目录下的条目名；不是目录时返回 null，用来区分「空目录」与「不存在」 */
const listNames = (dir: string): string[] | null => {
  try {
    return readdirSync(dir);
  } catch {
    return null;
  }
};

/** 递归收集 Markdown 文件的相对路径；深度超限即停 */
const listMarkdownFiles = (dir: string, depth = 0): string[] => {
  const names = listNames(dir);
  if (!names || depth > PLUGIN_COMPONENT_SCAN_MAX_DEPTH) return [];
  const result: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    if (isDirectory(path)) {
      result.push(...listMarkdownFiles(path, depth + 1).map((relative) => join(name, relative)));
      continue;
    }
    if (name.endsWith(MARKDOWN_EXTENSION)) result.push(name);
  }
  return result;
};

/**
 * 组件路径的硬校验：`./` 前缀、落在插件根内、符号链接不逃出根。
 * 越界抛 `plugin_component_invalid`——显式安装时直接失败，发现路径上由调用方收敛成诊断。
 */
export const assertComponentPath = (root: string, raw: string, allowRoot = false): string => {
  const invalid = (message: string): AppError =>
    new AppError(ERROR_CODES.pluginComponentInvalid, message, 400, undefined, { path: raw });

  const trimmed = raw.trim();
  if (allowRoot && (trimmed === "." || trimmed === "./")) return root;
  if (!trimmed.startsWith("./")) throw invalid(`组件路径需以 "./" 开头：${raw}`);

  const target = resolve(root, trimmed);
  if (!isInsidePath(root, target)) throw invalid(`组件路径越出插件根：${raw}`);

  const realRoot = realpathOf(root);
  const real = realpathOf(target);
  if (realRoot && real && !isInsidePath(realRoot, real)) {
    throw invalid(`组件路径经符号链接越出插件根：${raw}`);
  }
  return target;
};

/** 解析路径并把失败收敛成诊断：发现路径上不因一个组件坏掉而丢掉整包 */
const resolveComponent = (
  ctx: ComponentContext,
  raw: string,
  group: PluginComponentGroup,
  allowRoot = false,
): string | null => {
  try {
    return assertComponentPath(ctx.root, raw, allowRoot);
  } catch (error) {
    ctx.diagnostics.push(diagnostic("error", group, describeError(error)));
    return null;
  }
};

const toPathList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** 声明路径与默认路径合并：`append` 为真时叠加（skills / extensions），否则显式声明替换默认 */
const componentPaths = (
  value: string | string[] | undefined,
  defaults: readonly string[],
  append: boolean,
): ComponentPathSpec[] => {
  const declared = toPathList(value).map((raw) => ({ raw, declared: true }));
  const fallback = defaults.map((raw) => ({ raw, declared: false }));
  const paths = append || declared.length === 0 ? [...fallback, ...declared] : declared;

  const seen = new Set<string>();
  return paths.filter((item) => {
    if (seen.has(item.raw)) return false;
    seen.add(item.raw);
    return true;
  });
};

/** 路径不存在：声明过的报错，默认布局的静默跳过 */
const reportMissing = (
  ctx: ComponentContext,
  spec: ComponentPathSpec,
  group: PluginComponentGroup,
  what: string,
): void => {
  if (!spec.declared) return;
  ctx.diagnostics.push(diagnostic("error", group, `${what}不存在：${spec.raw}`));
};

const collectSkills = (
  ctx: ComponentContext,
  value: PluginManifest["skills"],
  entries: PluginComponentEntry[],
): void => {
  const specs = componentPaths(value, PLUGIN_COMPONENT_DEFAULT_PATHS.skills, true);
  for (const spec of specs) {
    const dir = resolveComponent(ctx, spec.raw, "skills", true);
    if (!dir) continue;
    ctx.assets.skills.push(dir);
    // 声明直接指向某个技能目录（自身含 SKILL.md）时按单个技能收，两种写法都能用
    if (isFile(join(dir, SKILL_FILENAME))) {
      entries.push({ group: "skills", name: basename(dir), path: dir });
      continue;
    }
    const names = listNames(dir);
    if (!names) {
      reportMissing(ctx, spec, "skills", "技能目录");
      continue;
    }
    for (const name of names) {
      const skillDir = join(dir, name);
      if (isFile(join(skillDir, SKILL_FILENAME))) {
        entries.push({ group: "skills", name, path: skillDir });
      }
    }
  }
};

const collectCommands = (
  ctx: ComponentContext,
  value: PluginManifest["commands"],
  entries: PluginComponentEntry[],
): void => {
  if (value !== undefined && typeof value !== "string" && !Array.isArray(value)) {
    // 对象形式是清单内联定义，替换默认目录
    for (const name of Object.keys(value)) entries.push({ group: "commands", name, path: null });
    return;
  }
  const specs = componentPaths(value, PLUGIN_COMPONENT_DEFAULT_PATHS.commands, false);
  for (const spec of specs) {
    const dir = resolveComponent(ctx, spec.raw, "commands");
    if (!dir) continue;
    if (!isDirectory(dir)) {
      reportMissing(ctx, spec, "commands", "命令目录");
      continue;
    }
    ctx.assets.prompts.push(dir);
    // 子目录扁平化：`db/migrate.md` → `db:migrate`
    for (const relative of listMarkdownFiles(dir)) {
      const name = toPosixPath(relative).replace(/\.md$/, "").split("/").join(":");
      entries.push({ group: "commands", name, path: join(dir, relative) });
    }
  }
};

const collectAgents = (
  ctx: ComponentContext,
  value: PluginManifest["agents"],
  entries: PluginComponentEntry[],
): void => {
  const specs = componentPaths(value, PLUGIN_COMPONENT_DEFAULT_PATHS.agents, false);
  for (const spec of specs) {
    const dir = resolveComponent(ctx, spec.raw, "agents");
    if (!dir) continue;
    const names = listNames(dir);
    if (!names) {
      reportMissing(ctx, spec, "agents", "角色目录");
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(MARKDOWN_EXTENSION)) continue;
      const path = join(dir, name);
      if (isFile(path)) {
        entries.push({ group: "agents", name: name.slice(0, -MARKDOWN_EXTENSION.length), path });
      }
    }
  }
};

const collectExtensions = (
  ctx: ComponentContext,
  value: PluginManifest["extensions"],
  entries: PluginComponentEntry[],
): void => {
  const specs = componentPaths(value, PLUGIN_COMPONENT_DEFAULT_PATHS.extensions, true);
  for (const spec of specs) {
    const target = resolveComponent(ctx, spec.raw, "extensions");
    if (!target) continue;
    ctx.assets.extensions.push(target);
    if (isFile(target)) {
      entries.push({ group: "extensions", name: basename(target), path: target });
      continue;
    }
    const names = listNames(target);
    if (!names) {
      reportMissing(ctx, spec, "extensions", "扩展目录");
      continue;
    }
    for (const name of names) {
      const path = join(target, name);
      if (isFile(path)) entries.push({ group: "extensions", name, path });
    }
  }
};

/** 单文件组件（hooks / MCP）：清单写成对象或数组时是内联定义，没有文件路径 */
const collectFileComponent = (
  ctx: ComponentContext,
  group: "hooks" | "mcp",
  defaultPath: string,
  value: unknown,
  entries: PluginComponentEntry[],
): void => {
  if (value !== undefined && typeof value !== "string") {
    entries.push({ group, name: group, path: null });
    return;
  }
  const spec: ComponentPathSpec = {
    raw: typeof value === "string" ? value : defaultPath,
    declared: typeof value === "string",
  };
  const path = resolveComponent(ctx, spec.raw, group);
  if (!path) return;
  if (!isFile(path)) {
    reportMissing(ctx, spec, group, "配置文件");
    return;
  }
  entries.push({ group, name: basename(path), path });
};

const collectBin = (ctx: ComponentContext, entries: PluginComponentEntry[]): void => {
  const path = resolveComponent(ctx, PLUGIN_BIN_COMPONENT_PATH, "bin");
  if (!path || !isDirectory(path)) return;
  entries.push({ group: "bin", name: basename(path), path });
};

/** 同一组件可能被默认目录与声明路径各收一次（声明指向默认目录内部），按组 + 路径去重 */
const uniqueEntries = (entries: readonly PluginComponentEntry[]): PluginComponentEntry[] => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.group}\u0000${entry.path ?? entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** 资产目录去重（声明与默认路径叠加时会重复），保持出现顺序 */
const uniqueAssets = (assets: PluginAssetDirs): PluginAssetDirs => ({
  skills: [...new Set(assets.skills)],
  prompts: [...new Set(assets.prompts)],
  extensions: [...new Set(assets.extensions)],
});

/** 解析一个插件包的全部组件；`manifest` 为 null 表示按标准目录布局装载 */
export const resolvePluginComponents = (input: {
  root: string;
  manifest: PluginManifest | null;
}): PluginComponents => {
  const ctx: ComponentContext = {
    root: input.root,
    diagnostics: [],
    assets: { skills: [], prompts: [], extensions: [] },
  };
  const entries: PluginComponentEntry[] = [];
  const manifest = input.manifest;

  collectSkills(ctx, manifest?.skills, entries);
  collectCommands(ctx, manifest?.commands, entries);
  collectAgents(ctx, manifest?.agents, entries);
  collectExtensions(ctx, manifest?.extensions, entries);
  collectFileComponent(ctx, "hooks", PLUGIN_HOOKS_COMPONENT_PATH, manifest?.hooks, entries);
  collectFileComponent(ctx, "mcp", PLUGIN_MCP_COMPONENT_PATH, manifest?.mcpServers, entries);
  collectBin(ctx, entries);

  return {
    entries: uniqueEntries(entries),
    assets: uniqueAssets(ctx.assets),
    diagnostics: ctx.diagnostics,
  };
};
