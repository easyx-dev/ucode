/**
 * 插件界面贡献的解析：清单 `ui` 段落 → 结构化声明（绝对文件路径 + 相对路径 + 诊断）。
 *
 * 路径校验与其它组件同一套（`assertComponentPath`）：越界、缺文件、后缀不对只丢该条目并出诊断，
 * 不整包失败。**来源门控不在这里做**——声明照常解析出来，能不能进渲染层由服务层的信任判定决定，
 * 设置页要能看到「它有界面，但没生效」。
 *
 * 模块一律是预构建 ESM（`.mjs` / `.js`），样式是 `.css`：宿主不做编译，作者自带构建产物。
 */
import { statSync } from "node:fs";
import { extname } from "node:path";

import {
  PLUGIN_UI_API_VERSION,
  PLUGIN_UI_LAYOUTS,
  type PluginDiagnosticView,
  type PluginUiBundle,
  type PluginUiDocRenderer,
  type PluginUiLayout,
  type PluginUiMention,
  type PluginUiMode,
  type PluginUiSettingsSection,
  type PluginUiView,
} from "@ucode/contracts";
import { z } from "zod";

import { PLUGIN_MODULE_EXTENSIONS, PLUGIN_STYLE_EXTENSIONS } from "../../constants/plugins";
import { assertComponentPath } from "./components";
import { describeError, diagnostic } from "./diagnostic";
import type { PluginComponentEntry } from "./types";

/** 允许的模块后缀：只认预构建产物，`.ts` / `.tsx` 由作者自己编译 */
const MODULE_EXTENSIONS = new Set<string>(PLUGIN_MODULE_EXTENSIONS);
const STYLE_EXTENSIONS = new Set<string>(PLUGIN_STYLE_EXTENSIONS);

/** 一个模块文件：`file` 供本进程读盘，`path` 是相对插件根的正斜杠路径（拼托管 URL 用） */
type PluginUiFile = {
  file: string;
  path: string;
};

export type PluginUiViewDecl = PluginUiFile & {
  id: string;
  label: string;
  icon: string;
  layout: PluginUiLayout;
  order: number;
  export?: string;
};

export type PluginUiDocRendererDecl = PluginUiFile & {
  extensions: string[];
  export?: string;
};

export type PluginUiMentionDecl = {
  /** 自定义芯片组件；只声明 scheme 时为 null（宿主用通用芯片） */
  file: string | null;
  path: string | null;
  scheme: string;
  export?: string;
};

export type PluginUiSettingsSectionDecl = PluginUiFile & {
  id: string;
  label: string;
  export?: string;
};

/** 清单 `ui` 解析出的全部声明；没有 `ui` 段时为 null */
export type PluginUiDeclaration = {
  apiVersion: number;
  styles: string[];
  views: PluginUiViewDecl[];
  docRenderers: PluginUiDocRendererDecl[];
  modes: PluginUiMode[];
  mentions: PluginUiMentionDecl[];
  settingsSections: PluginUiSettingsSectionDecl[];
};

const moduleShape = {
  module: z.string({ error: "module 必须是字符串" }),
  export: z.string().optional(),
};

const uiSchema = z.object({
  apiVersion: z.number().int().positive().optional(),
  styles: z.array(z.string()).optional(),
  views: z
    .array(
      z.object({
        ...moduleShape,
        id: z.string({ error: "view 需要 id" }),
        label: z.string().optional(),
        icon: z.string().optional(),
        layout: z.enum(PLUGIN_UI_LAYOUTS).optional(),
        order: z.number().optional(),
      }),
    )
    .optional(),
  docRenderers: z
    .array(
      z.object({
        ...moduleShape,
        extensions: z.array(z.string({ error: "extensions 需为字符串数组" })),
      }),
    )
    .optional(),
  modes: z
    .array(
      z.object({
        slug: z.string(),
        icon: z.string().optional(),
        label: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  mentions: z
    .array(
      z.object({
        module: z.string().optional(),
        export: z.string().optional(),
        scheme: z.string(),
      }),
    )
    .optional(),
  settingsSections: z
    .array(z.object({ ...moduleShape, id: z.string(), label: z.string().optional() }))
    .optional(),
});

/** 解析上下文：诊断与已解析组件边解析边收集 */
type UiContext = {
  pluginId: string;
  root: string;
  diagnostics: PluginDiagnosticView[];
  components: PluginComponentEntry[];
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** 相对插件根的正斜杠路径：清单里的 `./dist/ui/x.mjs` → `dist/ui/x.mjs` */
const relativePath = (raw: string): string => raw.replace(/\\/g, "/").replace(/^\.\//, "");

/**
 * 解析一个模块 / 样式路径：越界、不存在、后缀不对都返回 null 并出诊断。
 * 走 `assertComponentPath` 而不是自己拼路径——符号链接逃出插件根也在那里挡住。
 */
const resolveUiFile = (
  ctx: UiContext,
  raw: string,
  allowed: ReadonlySet<string>,
  what: string,
): PluginUiFile | null => {
  const fail = (message: string): null => {
    ctx.diagnostics.push(diagnostic("error", "ui", `${what}：${message}`));
    return null;
  };
  let file: string;
  try {
    file = assertComponentPath(ctx.root, raw);
  } catch (error) {
    return fail(describeError(error));
  }
  if (!isFile(file)) return fail(`文件不存在（${raw}）`);
  if (!allowed.has(extname(file).toLowerCase())) {
    return fail(`后缀不受支持（${raw}）：只认预构建产物 ${[...allowed].join(" / ")}`);
  }
  return { file, path: relativePath(raw) };
};

const toTitle = (value: string, fallback: string): string =>
  value.trim() ? value.trim() : fallback;

/** 解析并归一化一个 `ui` 段落；`value` 为 undefined 表示插件没有界面贡献 */
export const loadPluginUi = (input: {
  pluginId: string;
  root: string;
  value: unknown;
}): { declaration: PluginUiDeclaration | null; diagnostics: PluginDiagnosticView[] } => {
  const ctx: UiContext = {
    pluginId: input.pluginId,
    root: input.root,
    diagnostics: [],
    components: [],
  };
  if (input.value === undefined) return { declaration: null, diagnostics: [] };

  const parsed = uiSchema.safeParse(input.value);
  if (!parsed.success) {
    ctx.diagnostics.push(
      diagnostic(
        "error",
        "ui",
        `清单 ui 段落非法，界面贡献已跳过（${parsed.error.issues.length} 处）`,
      ),
    );
    return { declaration: null, diagnostics: ctx.diagnostics };
  }
  const ui = parsed.data;

  const apiVersion = ui.apiVersion ?? PLUGIN_UI_API_VERSION;
  if (apiVersion !== PLUGIN_UI_API_VERSION) {
    // 版本对不上整段跳过：半个界面比没有界面更难排查
    ctx.diagnostics.push(
      diagnostic(
        "warning",
        "ui",
        `界面运行时版本 ${apiVersion} 与宿主实现的 ${PLUGIN_UI_API_VERSION} 不一致，界面贡献已跳过`,
      ),
    );
    return { declaration: null, diagnostics: ctx.diagnostics };
  }

  const styles: string[] = [];
  for (const raw of ui.styles ?? []) {
    const resolved = resolveUiFile(ctx, raw, STYLE_EXTENSIONS, "样式表");
    if (resolved) styles.push(resolved.path);
  }

  const views: PluginUiViewDecl[] = [];
  for (const item of ui.views ?? []) {
    const file = resolveUiFile(ctx, item.module, MODULE_EXTENSIONS, `视图 ${item.id}`);
    if (!file) continue;
    views.push({
      ...file,
      id: item.id,
      label: toTitle(item.label ?? "", item.id),
      icon: toTitle(item.icon ?? "", "layout-template"),
      layout: item.layout ?? "sidebar",
      order: item.order ?? 0,
      ...(item.export ? { export: item.export } : {}),
    });
  }

  const docRenderers: PluginUiDocRendererDecl[] = [];
  for (const item of ui.docRenderers ?? []) {
    const file = resolveUiFile(ctx, item.module, MODULE_EXTENSIONS, "文档渲染器");
    if (!file) continue;
    const extensions = [
      ...new Set(
        item.extensions
          .map((value) => value.trim().toLowerCase().replace(/^\./, ""))
          .filter(Boolean),
      ),
    ];
    if (extensions.length === 0) {
      ctx.diagnostics.push(diagnostic("warning", "ui", "文档渲染器没声明 extensions，已跳过"));
      continue;
    }
    docRenderers.push({ ...file, extensions, ...(item.export ? { export: item.export } : {}) });
  }

  const mentions: PluginUiMentionDecl[] = [];
  for (const item of ui.mentions ?? []) {
    // 只声明 scheme（芯片由宿主通用渲染）也合法；给了 module 才去校验那支组件
    if (item.module === undefined) {
      mentions.push({ file: null, path: null, scheme: item.scheme });
      continue;
    }
    const file = resolveUiFile(ctx, item.module, MODULE_EXTENSIONS, `提及 ${item.scheme}`);
    if (!file) continue;
    mentions.push({
      ...file,
      scheme: item.scheme,
      ...(item.export ? { export: item.export } : {}),
    });
  }

  const settingsSections: PluginUiSettingsSectionDecl[] = [];
  for (const item of ui.settingsSections ?? []) {
    const file = resolveUiFile(ctx, item.module, MODULE_EXTENSIONS, `设置分区 ${item.id}`);
    if (!file) continue;
    settingsSections.push({
      ...file,
      id: item.id,
      label: toTitle(item.label ?? "", item.id),
      ...(item.export ? { export: item.export } : {}),
    });
  }

  const modes: PluginUiMode[] = (ui.modes ?? []).map((item) => ({
    pluginId: input.pluginId,
    slug: item.slug,
    label: toTitle(item.label ?? "", item.slug),
    description: (item.description ?? "").trim(),
    icon: toTitle(item.icon ?? "", "sparkles"),
  }));

  return {
    declaration: {
      apiVersion,
      styles,
      views,
      docRenderers,
      modes,
      mentions,
      settingsSections,
    },
    diagnostics: ctx.diagnostics,
  };
};

/** 组件表里的界面条目：设置页按组计数与展开，名字带上类别前缀便于区分同名的视图与分区 */
export const uiComponentEntries = (
  declaration: PluginUiDeclaration | null,
): PluginComponentEntry[] => {
  if (!declaration) return [];
  return [
    ...declaration.views.map((view) => ({
      group: "ui" as const,
      name: `view:${view.id}`,
      path: view.file,
    })),
    ...declaration.docRenderers.map((renderer) => ({
      group: "ui" as const,
      name: `doc:${renderer.extensions.join(",")}`,
      path: renderer.file,
    })),
    ...declaration.mentions.map((mention) => ({
      group: "ui" as const,
      name: `mention:${mention.scheme}`,
      path: mention.file,
    })),
    ...declaration.settingsSections.map((section) => ({
      group: "ui" as const,
      name: `settings:${section.id}`,
      path: section.file,
    })),
  ];
};

/** 托管的模块 URL：相对接口基址，客户端拼挂载前缀后再 import */
const moduleUrl = (pluginId: string, path: string): string =>
  `plugins/${encodeURIComponent(pluginId)}/ui/${path}`;

/**
 * 声明 → 下发给渲染层的贡献包。`revision` 进模块 URL 的查询串：插件版本或注册表代次一变，
 * 浏览器就会重新取模块（本地目录来源改完点「重拉」正是走这条路）。
 */
export const toPluginUiBundle = (input: {
  id: string;
  name: string;
  displayName: string;
  version: string;
  revision: number;
  declaration: PluginUiDeclaration | null;
}): PluginUiBundle | null => {
  const declaration = input.declaration;
  if (!declaration) return null;
  const pluginId = input.id;
  const views: PluginUiView[] = declaration.views.map((view) => ({
    pluginId,
    id: view.id,
    label: view.label,
    icon: view.icon,
    layout: view.layout,
    order: view.order,
    url: moduleUrl(pluginId, view.path),
    ...(view.export ? { export: view.export } : {}),
  }));
  const docRenderers: PluginUiDocRenderer[] = declaration.docRenderers.map((renderer) => ({
    pluginId,
    extensions: renderer.extensions,
    url: moduleUrl(pluginId, renderer.path),
    ...(renderer.export ? { export: renderer.export } : {}),
  }));
  const mentions: PluginUiMention[] = declaration.mentions.map((mention) => ({
    pluginId,
    scheme: mention.scheme,
    ...(mention.path ? { url: moduleUrl(pluginId, mention.path) } : {}),
    ...(mention.export ? { export: mention.export } : {}),
  }));
  const settingsSections: PluginUiSettingsSection[] = declaration.settingsSections.map(
    (section) => ({
      pluginId,
      id: section.id,
      label: section.label,
      url: moduleUrl(pluginId, section.path),
      ...(section.export ? { export: section.export } : {}),
    }),
  );

  return {
    id: pluginId,
    name: input.name,
    displayName: input.displayName,
    revision: `${input.version}:${input.revision}`,
    styles: declaration.styles.map((path) => moduleUrl(pluginId, path)),
    views,
    docRenderers,
    modes: declaration.modes,
    mentions,
    settingsSections,
  };
};
