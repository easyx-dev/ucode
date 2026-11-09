/**
 * 插件界面运行时 API 的类型与安装点（公开面：`@ucode/ui/plugin`）。
 *
 * 三件事在这里定死：
 * 1. **版本**：插件清单 `ui.apiVersion` 要等于 `PLUGIN_UI_API_VERSION`，否则界面贡献整段跳过；
 * 2. **形状**：插件模块只能拿到这里列出的能力（React、UI 原语、动作白名单、i18n、宿主上下文），
 *    没有 SDK client、没有裸 `fetch`——能力边界靠「不暴露」而不是靠约定；
 * 3. **注入点**：宿主把这份对象装到全局（键名由品牌 slug 派生），服务端托管插件模块时把
 *    `@ucode/plugin-api` / `react` / `react/jsx-runtime` 改写成读它的 shim。
 *
 * 插件模块**不许自带 React**：两份 React 会让 hooks 直接报 Invalid hook call，所以插件只能从这里取。
 */

import { brand } from "@ucode/brand/values";
import type * as React from "react";
import type { Button, IconButton } from "../base/button";
import type {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../base/context-menu";
import type {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../base/dropdown-menu";
import type { Empty } from "../base/empty";
import type { FloatingPanel } from "../base/floating-panel";
import type { ScrollArea } from "../base/scroll-area";
import type { Spinner } from "../base/spinner";
import type { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../base/tooltip";

/** 宿主实现的运行时版本；与清单 `ui.apiVersion` 比对，不等的插件界面不加载 */
export const PLUGIN_UI_API_VERSION = 1;

/**
 * 宿主注入点：插件模块的 shim 从全局读它。
 * 键名由品牌 slug 派生（B 端定制换了品牌就是另一份），两端各自算同一个字符串。
 */
export const PLUGIN_HOST_GLOBAL = `__${brand.slug.toUpperCase()}_PLUGIN_HOST__`;

/**
 * 插件能拿到的动作白名单。
 *
 * 插件只能**请求**这些动作，具体落到哪个会话 / 哪块面板由宿主决定——这样插件拿不到
 * 「当前上下文之外」的东西，宿主也不必担心某个插件把界面切到别的会话上。
 */
export type PluginUiActions = {
  /** 打开工作台里的某个文件（预览标签），`path` 相对会话工作目录 */
  openFile: (path: string) => void;
  /**
   * 打开或激活某个插件的视图。`pluginId` 要显式给：动作表是所有插件共用的一份，
   * 宿主不替调用方猜「你是哪个插件」（同理 `http.call` / `events.on`）。
   */
  openView: (pluginId: string, viewId: string) => void;
  /** 收起工作台 */
  collapse: () => void;
  /** 往输入框落一枚引用锚点（`@<scheme>:<payload>` 那种）；用户仍可编辑 */
  insertMention: (item: { scheme: string; label: string; anchor: string }) => void;
  /** 弹一条提示（成功 / 失败一句话），样式与宿主一致 */
  notify: (message: string, tone?: "info" | "success" | "error") => void;
};

/** 插件界面拿得到的宿主上下文：每次渲染给一份，跟着会话与工作目录走 */
export type PluginUiHostInfo = {
  pluginId: string;
  /** 当前会话 id；草稿态（还没有会话）为 null */
  sessionId: string | null;
  /** 会话工作目录；null 表示没有工作目录 */
  cwd: string | null;
  /** 当前界面语言（插件自带 catalog 时按它选目录） */
  language: string;
};

/** 插件组件拿到的 props；三个字段都是**每次渲染新给**的 */
export type PluginUiComponentProps = {
  host: PluginUiHostInfo;
  /** 宿主是否把这块界面显示在窄屏（触屏）上；插件按它决定密度与交互（下拉 vs 上拉菜单） */
  narrow: boolean;
  /** 文档渲染器专有：被打开的文件路径（相对会话工作目录）；视图不传 */
  path?: string;
};

/** 插件界面可用的 UI 原语：与宿主同一套实现，因此 token、圆角、暗色模式自然一致 */
export type PluginUiPrimitives = {
  Button: typeof Button;
  IconButton: typeof IconButton;
  Empty: typeof Empty;
  Spinner: typeof Spinner;
  ScrollArea: typeof ScrollArea;
  FloatingPanel: typeof FloatingPanel;
  Tooltip: typeof Tooltip;
  TooltipTrigger: typeof TooltipTrigger;
  TooltipContent: typeof TooltipContent;
  TooltipProvider: typeof TooltipProvider;
  DropdownMenu: typeof DropdownMenu;
  DropdownMenuTrigger: typeof DropdownMenuTrigger;
  DropdownMenuContent: typeof DropdownMenuContent;
  DropdownMenuItem: typeof DropdownMenuItem;
  DropdownMenuLabel: typeof DropdownMenuLabel;
  DropdownMenuSeparator: typeof DropdownMenuSeparator;
  ContextMenu: typeof ContextMenu;
  ContextMenuTrigger: typeof ContextMenuTrigger;
  ContextMenuContent: typeof ContextMenuContent;
  ContextMenuItem: typeof ContextMenuItem;
  ContextMenuLabel: typeof ContextMenuLabel;
  ContextMenuSeparator: typeof ContextMenuSeparator;
};

/** 从 `@ucode/plugin-api` 拿到的全部能力 */
export type PluginUiApi = {
  version: number;
  react: typeof React;
  /**
   * 内部：给打进插件产物的 CommonJS 依赖用的 require 表（键是模块名）。
   * 插件作者不直接用；构建产的 `require` 垫片从全局运行时上读它。
   */
  cjs: Record<string, unknown>;
  /** 插件组件用到 portal / flushSync 时的那几个入口（与 react 同一份实例） */
  reactDom: {
    createPortal: typeof import("react-dom")["createPortal"];
    flushSync: typeof import("react-dom")["flushSync"];
  };
  /** 插件用不到的细节：JSX 编译产物由 `react/jsx-runtime` shim 转发到它 */
  jsxRuntime: {
    Fragment: unknown;
    jsx: unknown;
    jsxs: unknown;
    jsxDEV: unknown;
  };
  ui: PluginUiPrimitives;
  hooks: {
    /** 是否桌面宽度：与宿主同一套断点，插件不自己量窗口 */
    useIsDesktop: () => boolean;
  };
  actions: PluginUiActions;
  /** 插件自己的数据面：只能打 `/api/v1/plugins/<自己的 id>/api/*` */
  http: {
    call: <T>(pluginId: string, action: string, body?: unknown) => Promise<T>;
  };
  /** 插件自有事件（宿主按 pluginId 转发的 `plugin_event`） */
  events: {
    /** 订阅本插件的事件；返回取消订阅函数 */
    on: (
      pluginId: string,
      handler: (event: { type: string; payload: unknown }) => void,
    ) => () => void;
  };
  i18n: {
    /** 宿主 i18n 实例的 `t`：key 就是中文原文，缺英文时回落 key，与内核文案同一口径 */
    t: (key: string, params?: Record<string, string | number>) => string;
    /** 注册插件自带的文案目录（扁平 key → 译文） */
    addResourceBundle: (language: string, resources: Record<string, string>) => void;
  };
};

/** 插件模块的导出形状：视图、文档渲染器、提及都按这个约定导出 React 组件 */
export type PluginUiComponent = (props: PluginUiComponentProps) => React.ReactNode;
/**
 * 把运行时装到全局；重复调用只更新引用，不重装（宿主只有一个实例）。
 * 走 `globalThis` 的索引赋值而不是给 `Window` 加声明：键名是运行时算出来的，不是字面量。
 */
export const installPluginHost = (api: PluginUiApi): void => {
  (globalThis as Record<string, unknown>)[PLUGIN_HOST_GLOBAL] = api;
};
