/**
 * 插件清单的发现与解析。
 *
 * 三档清单目录按「本品牌 → zcode → claude」识别，第一个命中生效；**清单可缺省**，
 * 此时按标准目录布局装载（与 Claude 一致）。解析分两条路：
 * 发现路径用 `loadPluginManifest`（坏清单跳过并收集诊断，不阻断其它插件），
 * 显式安装路径用 `parsePluginManifest`（清单坏了就抛 `plugin_manifest_invalid`）。
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  ERROR_CODES,
  type PluginComponentGroup,
  type PluginDiagnosticLevel,
  type PluginDiagnosticView,
} from "@ucode/contracts";
import { z } from "zod";

import {
  PLUGIN_COMPAT_MANIFEST_DIRNAMES,
  PLUGIN_MANIFEST_DIRNAME,
  PLUGIN_MANIFEST_FILENAME,
} from "../../constants/dirs";
import {
  PLUGIN_IGNORED_DEPENDENCY_KEY,
  PLUGIN_IGNORED_MANIFEST_KEYS,
  PLUGIN_MANIFEST_MAX_BYTES,
} from "../../constants/plugins";
import { AppError } from "../../platform/response";
import { isRecord } from "../../utils/object";
import { resolvePluginComponents } from "./components";
import { describeError, diagnostic } from "./diagnostic";
import type { PluginAssetDirs, PluginComponentEntry } from "./types";

/** 降级装载时的空资产集：共用同一个常量，免得每处造一份 */
const EMPTY_ASSETS: PluginAssetDirs = { skills: [], prompts: [], extensions: [] };

/** 清单 `name` 的字符集：同时是插件 id 的前半段与 token 来源 */
export const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

const pathListSchema = z.union([z.string(), z.array(z.string())]);

/**
 * 清单的字段形状。**宽松解析**：不认识的字段剥离并告警（`.strict()` 会把 Claude / ZCode
 * 新加的键变成装载失败），只有字段类型不符才算坏清单。
 */
const manifestShape = {
  name: z.string().optional(),
  displayName: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z
    .union([
      z.string(),
      z.object({ name: z.string(), email: z.string().optional(), url: z.string().optional() }),
    ])
    .optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  defaultEnabled: z.boolean().optional(),
  skills: pathListSchema.optional(),
  commands: z.union([pathListSchema, z.record(z.string(), z.unknown())]).optional(),
  agents: pathListSchema.optional(),
  hooks: z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  mcpServers: z
    .union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
    .optional(),
  extensions: pathListSchema.optional(),
  userConfig: z.record(z.string(), z.unknown()).optional(),
  /**
   * 界面贡献（本产品专属）：视图、文档渲染器、提及渲染器、设置分区与样式表。
   * 形状一个字段一个字段地在 `harness/plugins/ui.ts` 里校验，这里只挡「不是对象」。
   */
  ui: z.record(z.string(), z.unknown()).optional(),
  /** 服务端模块（本产品专属）：进程内加载的入口，提供自有路由与工具 */
  server: z.string().optional(),
  /**
   * 服务端模块提供的工具名。角色文件的 `tools` 白名单里可以写它们——
   * 不列出来的话，白名单只认宿主知道的内置工具名，插件自己的工具会被判成「不认识」而丢掉。
   */
  tools: z.array(z.string()).optional(),
};

export const pluginManifestSchema = z.object(manifestShape);

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** 按识别顺序找清单文件；包内没有清单时返回 null 并走标准目录布局 */
export const findManifestFile = (root: string): string | null => {
  for (const dirname of [PLUGIN_MANIFEST_DIRNAME, ...PLUGIN_COMPAT_MANIFEST_DIRNAMES]) {
    const file = join(root, dirname, PLUGIN_MANIFEST_FILENAME);
    if (existsSync(file)) return file;
  }
  return null;
};

const invalidManifest = (file: string, message: string, details?: unknown): AppError =>
  new AppError(ERROR_CODES.pluginManifestInvalid, `${message}：${file}`, 400, details, {
    path: file,
  });

/** 解析清单正文；JSON 坏、超限或字段类型不符都抛 `plugin_manifest_invalid`（显式安装的硬失败） */
export const parsePluginManifest = (content: string, file: string): PluginManifest => {
  if (Buffer.byteLength(content, "utf8") > PLUGIN_MANIFEST_MAX_BYTES) {
    throw invalidManifest(file, `清单超过体积上限（${PLUGIN_MANIFEST_MAX_BYTES} 字节）`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw invalidManifest(file, "清单不是合法的 JSON", describeError(error));
  }
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) throw invalidManifest(file, "清单字段非法", parsed.error.issues);
  return parsed.data;
};

/** 读清单原始对象：读不到、超限、不是 JSON 对象都只回诊断，交给调用方决定怎么降级 */
const readManifestObject = (
  file: string,
): { raw: Record<string, unknown> } | { diagnostics: PluginDiagnosticView[] } => {
  const manifest = (message: string): PluginDiagnosticView[] => [
    diagnostic("error", "manifest", message),
  ];

  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    return { diagnostics: manifest(`清单读不出来（${describeError(error)}）`) };
  }
  if (Buffer.byteLength(content, "utf8") > PLUGIN_MANIFEST_MAX_BYTES) {
    return {
      diagnostics: manifest(`清单超过体积上限（${PLUGIN_MANIFEST_MAX_BYTES} 字节）`),
    };
  }
  try {
    const raw: unknown = JSON.parse(content);
    if (!isRecord(raw)) return { diagnostics: manifest("清单顶层不是对象") };
    return { raw };
  } catch (error) {
    return {
      diagnostics: manifest(`清单不是合法的 JSON 对象（${describeError(error)}）`),
    };
  }
};

const keyDiagnostic = (
  level: PluginDiagnosticLevel,
  component: PluginComponentGroup,
  message: string,
): PluginDiagnosticView => diagnostic(level, component, message);

/** 顶层键的诊断：识别但不执行的键出 info，未知键出 warning，都不影响其它组件 */
export const manifestKeyDiagnostics = (raw: Record<string, unknown>): PluginDiagnosticView[] => {
  const ignored = new Set<string>(PLUGIN_IGNORED_MANIFEST_KEYS);
  const result: PluginDiagnosticView[] = [];
  for (const name of Object.keys(raw)) {
    if (name in manifestShape) continue;
    if (name === PLUGIN_IGNORED_DEPENDENCY_KEY) {
      result.push(
        keyDiagnostic("info", "manifest", "跨插件依赖（dependencies）本轮不解析，已忽略"),
      );
      continue;
    }
    if (ignored.has(name)) {
      result.push(keyDiagnostic("info", "manifest", `字段 ${name} 已识别但本轮不执行`));
      continue;
    }
    result.push(keyDiagnostic("warning", "manifest", `未知字段 ${name} 已忽略`));
  }
  return result;
};

/** 一条 userConfig 声明：类型由清单给出，宿主按它渲染表单 */
export type PluginUserConfigField = {
  key: string;
  type: string;
  title: string;
  description: string;
  required: boolean;
  default?: string | number | boolean;
  options?: string[];
  multiple?: boolean;
  sensitive?: boolean;
};

const USER_CONFIG_TYPES = new Set(["string", "number", "boolean", "directory", "file", "select"]);

/** 解析 userConfig：认不出类型的项只诊断（渲染不出控件，硬塞一个 input 反而误导） */
const parseUserConfig = (
  value: Record<string, unknown> | undefined,
  diagnostics: PluginDiagnosticView[],
): PluginUserConfigField[] => {
  if (!value) return [];
  const fields: PluginUserConfigField[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      diagnostics.push(
        keyDiagnostic("warning", "userConfig", `userConfig.${key} 不是对象，已忽略`),
      );
      continue;
    }
    const type = typeof raw.type === "string" ? raw.type : "string";
    if (!USER_CONFIG_TYPES.has(type)) {
      diagnostics.push(
        keyDiagnostic("warning", "userConfig", `userConfig.${key} 的类型 ${type} 不认识，已忽略`),
      );
      continue;
    }
    const options = Array.isArray(raw.options)
      ? raw.options.filter((item): item is string => typeof item === "string")
      : undefined;
    fields.push({
      key,
      type,
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : key,
      description: typeof raw.description === "string" ? raw.description.trim() : "",
      required: raw.required === true,
      ...(typeof raw.default === "string" ||
      typeof raw.default === "number" ||
      typeof raw.default === "boolean"
        ? { default: raw.default }
        : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(raw.multiple === true ? { multiple: true } : {}),
      ...(raw.sensitive === true ? { sensitive: true } : {}),
    });
  }
  return fields;
};

/** 清单装载结果：清单本身 + 解析出的组件 + 诊断；诊断只描述问题，不阻断其它组件 */
export type PluginManifestLoad = {
  /** 清单文件绝对路径；按标准目录布局装载时为 null */
  file: string | null;
  manifest: PluginManifest | null;
  /** 插件名：清单没给（或非法）时回落安装目录名 */
  name: string;
  displayName: string;
  version: string;
  description: string;
  components: PluginComponentEntry[];
  /** userConfig 的声明；清单里写坏的项只出诊断、不进这份表 */
  userConfig: PluginUserConfigField[];
  /** 装配期注入用的目录（loader 收的是目录，不是逐个组件） */
  assets: PluginAssetDirs;
  diagnostics: PluginDiagnosticView[];
};

/** 清单缺失、读不出来或字段非法时的结果：名字回落目录名，不装载组件 */
const degradedLoad = (
  name: string,
  file: string | null,
  diagnostics: PluginDiagnosticView[],
): PluginManifestLoad => ({
  file,
  manifest: null,
  name,
  displayName: name,
  version: "0.0.0",
  description: "",
  components: [],
  userConfig: [],
  assets: EMPTY_ASSETS,
  diagnostics,
});

/** 由清单与已解析组件组装装载结果：展示名 / 版本 / 说明以清单为准，缺省回落目录名与 `0.0.0` */
const manifestLoad = (
  file: string,
  manifest: PluginManifest,
  name: string,
  diagnostics: PluginDiagnosticView[],
  resolved: {
    components: PluginComponentEntry[];
    userConfig: PluginUserConfigField[];
    assets: PluginAssetDirs;
  },
): PluginManifestLoad => ({
  file,
  manifest,
  name,
  displayName: manifest.displayName?.trim() || name,
  version: manifest.version?.trim() || "0.0.0",
  description: manifest.description?.trim() || "",
  components: resolved.components,
  userConfig: resolved.userConfig,
  assets: resolved.assets,
  diagnostics,
});

/**
 * 装载一个插件包的清单与组件。清单坏了**不装载组件**（作者想要的布局已经无从判断），
 * 但插件仍以诊断的形式出现在列表里，用户可以卸载它。
 */
export const loadPluginManifest = (root: string): PluginManifestLoad => {
  const name = basename(root);
  const file = findManifestFile(root);
  if (!file) {
    const resolved = resolvePluginComponents({ root, manifest: null });
    return {
      ...degradedLoad(name, null, resolved.diagnostics),
      components: resolved.entries,
      userConfig: [],
      assets: resolved.assets,
    };
  }

  const read = readManifestObject(file);
  if ("diagnostics" in read) return degradedLoad(name, file, read.diagnostics);

  const diagnostics = manifestKeyDiagnostics(read.raw);
  const parsed = pluginManifestSchema.safeParse(read.raw);
  if (!parsed.success) {
    diagnostics.unshift(keyDiagnostic("error", "manifest", "清单字段非法，已跳过全部组件"));
    return degradedLoad(name, file, diagnostics);
  }

  const manifest = parsed.data;
  let resolvedName = name;
  if (manifest.name !== undefined) {
    if (PLUGIN_NAME_PATTERN.test(manifest.name)) resolvedName = manifest.name;
    else
      diagnostics.push(
        keyDiagnostic(
          "error",
          "manifest",
          `name "${manifest.name}" 不合法，已回落目录名 "${name}"`,
        ),
      );
  }

  const resolved = resolvePluginComponents({ root, manifest });
  const userConfig = parseUserConfig(manifest.userConfig, diagnostics);
  return manifestLoad(file, manifest, resolvedName, [...diagnostics, ...resolved.diagnostics], {
    components: resolved.entries,
    userConfig,
    assets: resolved.assets,
  });
};
