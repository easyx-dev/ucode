/**
 * 插件界面贡献：服务端把清单声明折成这份形状下发，渲染层宿主按它加载模块、装配视图。
 *
 * 模块一律是**预构建 ESM**，由服务端从插件安装目录托管；`url` 是相对接口基址的路径
 * （如 `plugins/design@packaged/ui/view.mjs`），客户端用 `apis.assetUrl` 拼上基址——
 * 挂在路径前缀下（中继的 `/d/<设备 id>`）时也成立。
 */
import { z } from "zod";

/** 宿主实现的界面运行时版本；插件在清单 `ui.apiVersion` 里声明自己要求的那一版 */
export const PLUGIN_UI_API_VERSION = 1;

/**
 * 视图的布局形态。`full` 表示占满主区、没有侧栏——设计稿清单与画布就是这种：
 * 它自己的「清单 / 画布」切换靠视图内部状态，宿主不替它分栏。
 */
export const PLUGIN_UI_LAYOUTS = ["sidebar", "full"] as const;

export type PluginUiLayout = (typeof PLUGIN_UI_LAYOUTS)[number];

/** 一个模块引用：`url` 相对接口基址，`export` 缺省时取 `default` */
export type PluginUiModuleRef = {
  /** 模块路径（相对接口基址，不带前导 `/`） */
  url: string;
  /** 导出名；缺省表示 `default` */
  export?: string;
};

/** 工作台视图：活动栏上多一个图标，点开是插件自己的面板 */
export type PluginUiView = PluginUiModuleRef & {
  pluginId: string;
  /** 视图 id，插件内唯一；宿主用 `<pluginId>:<id>` 作为稳定键 */
  id: string;
  /** 展示名（插件自带文案，宿主不再本地化——插件提供自己的 i18n 目录） */
  label: string;
  /** 图标名，取宿主约定的 lucide 名单；认不出时回落默认图标 */
  icon: string;
  layout: PluginUiLayout;
  /** 活动栏内的次序，小的靠上；同值时按插件 id 排 */
  order: number;
};

/** 编辑器文档渲染器：按文件扩展名接管编辑器区内容（`.design` → 插件画布） */
export type PluginUiDocRenderer = PluginUiModuleRef & {
  pluginId: string;
  /** 接管的扩展名：小写、不带点 */
  extensions: string[];
};

/**
 * 主模式的界面元数据：slug 与 `AgentView.slug` 对齐（它就是会话的 `mode`）。
 * 文案由插件给——模式列表在前端是从插件贡献里拼出来的，宿主不认识这个模式的语义。
 */
export type PluginUiMode = {
  pluginId: string;
  slug: string;
  label: string;
  description: string;
  icon: string;
};

/**
 * 引用锚点：声明一个方言 scheme（`@<scheme>:<payload>`）。
 *
 * 芯片由宿主通用渲染（短名 + 悬停露出锚点），所以 `url` 可以不填；填了则是插件自己的芯片组件，
 * 用于需要专门呈现的锚点。
 */
export type PluginUiMention = {
  pluginId: string;
  /** 方言里的 scheme 名（`@design:…` 的 `design`） */
  scheme: string;
  /** 自定义芯片组件（相对接口基址的模块路径）；缺省用宿主通用芯片 */
  url?: string;
  /** 芯片组件的导出名；缺省 `default` */
  export?: string;
};

/** 设置页里的一块插件面板 */
export type PluginUiSettingsSection = PluginUiModuleRef & {
  pluginId: string;
  id: string;
  label: string;
};

/** 一个启用且受信任的插件贡献的全部界面面 */
export type PluginUiBundle = {
  /** 插件 id（`<name>@<marketplace>`） */
  id: string;
  name: string;
  displayName: string;
  /** 模块缓存键：版本与来源内容摘要的组合，变了就重新 import */
  revision: string;
  /** 插件自带的样式表（相对接口基址），宿主按需注入 `<link>` */
  styles: string[];
  views: PluginUiView[];
  docRenderers: PluginUiDocRenderer[];
  modes: PluginUiMode[];
  mentions: PluginUiMention[];
  settingsSections: PluginUiSettingsSection[];
};

export type PluginsUiResponse = {
  /** 宿主实现的运行时版本；插件按 `apiVersion` 对不上会被跳过并出诊断 */
  apiVersion: number;
  plugins: PluginUiBundle[];
  /**
   * 读取插件资源（模块与样式）的短时票。浏览器的 `import()` 与 `<link>` 带不了 `Authorization`，
   * 所以资源地址要带上它；过期后重新取一次本清单即可。
   */
  assetTicket: string;
  /** 票的过期时间（ISO），客户端不必用，留给排障 */
  assetTicketExpiresAt: string;
};

export const pluginUiInputSchema = z.object({
  /** 当前工作目录：给了就按它算项目级覆盖后的生效开关 */
  cwd: z.string().min(1).optional(),
});

export type PluginUiRequest = z.input<typeof pluginUiInputSchema>;
export type PluginUiInput = z.infer<typeof pluginUiInputSchema>;
