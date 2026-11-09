/**
 * 插件界面宿主：取贡献清单、按需加载插件模块、把模块里的组件装到工作台与编辑器区。
 *
 * 三条边界：
 * - **能力面由 `plugin-api.ts` 定死**：插件只拿到 `PluginUiApi`，够不到 SDK client 的白名单之外；
 * - **失败只影响那一块**：import 失败、导出不是组件、渲染抛错都收敛成插件自己的降级界面
 *   （`PluginBoundary`），不把整块工作台带崩；
 * - **样式按需注入**：插件自带的 CSS 以 `<link data-plugin-ui>` 挂到 `<head>`，清单 revision 变了
 *   地址跟着变，旧表随之摘掉。
 *
 * 这里不认识设计、终端这类具体功能，只认识贡献点的类型——它是「插件界面」的通用落点。
 */
import type { PluginUiBundle, PluginUiDocRenderer, PluginUiView } from "@ucode/contracts";
import * as React from "react";
import {
  Component,
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createPortal, flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button, IconButton } from "../base/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../base/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../base/dropdown-menu";
import { Empty } from "../base/empty";
import { FloatingPanel } from "../base/floating-panel";
import { ScrollArea } from "../base/scroll-area";
import { Spinner } from "../base/spinner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../base/tooltip";
import { useIsDesktop } from "../hooks/use-is-desktop";
import { useStore } from "../hooks/use-store";
import { extensionOf } from "../utils/preview";
import { useClient } from "./index";
import {
  installPluginHost,
  PLUGIN_UI_API_VERSION,
  type PluginUiActions,
  type PluginUiApi,
  type PluginUiComponent,
  type PluginUiComponentProps,
  type PluginUiHostInfo,
} from "./plugin-api";
import { useWorkbench } from "./workbench";

/** 模块缓存：键是带 revision 的 URL，`plugins_changed` 换 revision 后自然重新 import */
const moduleCache = new Map<string, Promise<Record<string, unknown>>>();

/** 导出名 → 组件；`export` 缺省取 `default`（没有再取第一个函数导出）。导出的不是函数即视为不可用 */
const componentOf = (
  module: Record<string, unknown>,
  name: string | undefined,
): PluginUiComponent | null => {
  const candidate = name
    ? module[name]
    : (module.default ?? Object.values(module).find((value) => typeof value === "function"));
  return typeof candidate === "function" ? (candidate as PluginUiComponent) : null;
};

/**
 * 插件资源地址：`?v=<revision>` 让换了版本就重新取，`ticket` 是浏览器带不了
 * `Authorization` 时的读取票（见服务端 `services/plugins/assets-tickets`）。
 */
const assetHref = (input: {
  url: string;
  revision: string;
  ticket: string;
  assetUrl: (path: string) => string;
}): string =>
  `${input.assetUrl(input.url)}?v=${encodeURIComponent(input.revision)}` +
  `&ticket=${encodeURIComponent(input.ticket)}`;

/** 加载某个模块引用指向的组件；失败返回 null（界面另有降级提示，控制台留一条线索） */
const loadComponent = async (input: {
  url: string;
  revision: string;
  ticket: string;
  export?: string;
  assetUrl: (path: string) => string;
}): Promise<PluginUiComponent | null> => {
  const url = assetHref(input);
  let pending = moduleCache.get(url);
  if (!pending) {
    pending = import(/* @vite-ignore */ url).then(
      (module: Record<string, unknown>) => module,
      (error: unknown) => {
        // 失败不进缓存：插件重拉后还能重试
        moduleCache.delete(url);
        throw error;
      },
    );
    moduleCache.set(url, pending);
  }
  try {
    return componentOf(await pending, input.export);
  } catch (error) {
    console.error("[plugin-ui] 插件模块加载失败", input.url, error);
    return null;
  }
};

/** 动作白名单：每个动作按「调用时」的上下文落地，插件拿到的是稳定引用 */
const createActions = (read: () => RuntimeContext | null): PluginUiActions => ({
  openFile: (path) => read()?.workbench?.openFile(path),
  openView: (pluginId, viewId) => {
    // 视图键是 `<pluginId>:<viewId>`
    read()?.workbench?.selectView(`${pluginId}:${viewId}`);
  },
  collapse: () => read()?.workbench?.collapse(),
  insertMention: (item) => read()?.workbench?.insertMention(item),
  notify: (message, tone = "info") => {
    if (tone === "error") toast.error(message);
    else if (tone === "success") toast.success(message);
    else toast(message);
  },
});

/** 组装宿主运行时：一个应用实例一份，插件模块的 shim 读的就是它 */
const createRuntime = (read: () => RuntimeContext | null): PluginUiApi => ({
  version: PLUGIN_UI_API_VERSION,
  react: React,
  reactDom: { createPortal, flushSync },
  cjs: {
    react: React,
    "react-dom": { createPortal, flushSync },
    "react/jsx-runtime": jsxRuntime,
  },
  jsxRuntime: {
    Fragment: jsxRuntime.Fragment,
    jsx: jsxRuntime.jsx,
    jsxs: jsxRuntime.jsxs,
    jsxDEV: (jsxRuntime as { jsxDEV?: unknown }).jsxDEV,
  },
  ui: {
    Button,
    IconButton,
    Empty,
    Spinner,
    ScrollArea,
    FloatingPanel,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
    TooltipProvider,
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
  },
  hooks: { useIsDesktop },
  actions: createActions(read),
  // 数据面与事件都是「插件自有」的：调用方把 pluginId 传进来，宿主不替它猜
  http: {
    call: (pluginId, action, body) =>
      read()?.client.apis.plugins.call(pluginId, action, body) as never,
  },
  events: {
    on: (pluginId, handler) =>
      read()?.client.events.onPluginEvent(pluginId, handler) ?? (() => undefined),
  },
  i18n: {
    t: (key, params) => interpolate(key, params),
    // 插件自带目录留到下一步：需要「宿主 i18n 实例可注册」的接缝，与内核文案同一张表
    addResourceBundle: () => undefined,
  },
});

/** 无 i18n 实例时的兜底插值：key 就是中文原文，`{{占位}}` 直接替换 */
const interpolate = (key: string, params?: Record<string, string | number>): string => {
  if (!params) return key;
  return key.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
};

/** 宿主上下文引用：动作读它，模块缓存下来的引用才不会指向过期的会话 */
type RuntimeContext = {
  host: PluginUiHostInfo;
  workbench: ReturnType<typeof useWorkbench>;
  client: ReturnType<typeof useClient>;
};

const RuntimeContextRef = createContext<{ current: RuntimeContext | null } | null>(null);

export type PluginUiHostValue = {
  apiVersion: number;
  plugins: PluginUiBundle[];
  views: PluginUiView[];
  docRenderers: PluginUiDocRenderer[];
  pluginOf: (pluginId: string) => PluginUiBundle | null;
  /** 取某个视图的组件（首次要 import）；不可用时为 null */
  viewComponent: (view: PluginUiView) => Promise<PluginUiComponent | null>;
  /** 按扩展名找接管该文档的组件；同时给出它的插件 id（组件里要用它调自己的接口） */
  docComponent: (
    extension: string,
  ) => Promise<{ pluginId: string; Component: PluginUiComponent } | null>;
};

const PluginUiContext = createContext<PluginUiHostValue | null>(null);

/**
 * 插件界面宿主。挂在 `UiProvider` 之内、工作台之外：它要读 client 的贡献清单，
 * 也要读工作台的会话与目录来算宿主上下文。
 */
export function PluginUiProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const workbench = useWorkbench();
  const contextRef = useRef<RuntimeContext | null>(null);
  contextRef.current = {
    host: {
      pluginId: "",
      sessionId: workbench?.sessionId ?? null,
      cwd: workbench?.cwd ?? null,
      language: "zh-CN",
    },
    workbench,
    client,
  };

  // 运行时只建一次：插件模块 import 时就把 `host.actions` 等引用捕获了，换实例会让它们指向旧对象。
  // 安装放在渲染期而不是 effect 里：effect 是子先父后，首屏就渲染插件视图时，模块 import 会早于
  // 父组件的安装 effect，shim 拿到 undefined 直接抛「宿主未就绪」，且不会自愈。
  const api = useMemo(() => {
    const created = createRuntime(() => contextRef.current);
    installPluginHost(created);
    return created;
  }, []);

  const state = useStore(client.pluginUi);
  const plugins = state.data?.plugins ?? [];
  const ticket = state.data?.assetTicket ?? "";
  const assetUrl = client.apis.assetUrl;
  const cwd = workbench?.cwd ?? null;

  // 工作目录变了要按新 cwd 重取：项目级覆盖可能把某个插件在本仓库里关掉。
  // 首屏（以及登录后）也靠这一次把清单拿到——store 自己只在构造时取一次，那次可能还没登录
  useEffect(() => {
    void client.pluginUi.load(cwd);
  }, [client, cwd]);

  // 样式：按清单挂 `<link>`，清单换了整批重挂（地址里带 revision）
  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    for (const bundle of plugins) {
      for (const href of bundle.styles) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = assetHref({ url: href, revision: bundle.revision, ticket, assetUrl });
        link.dataset.pluginUi = bundle.id;
        document.head.append(link);
        links.push(link);
      }
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [plugins, assetUrl, ticket]);

  const value = useMemo<PluginUiHostValue>(() => {
    const revisionOf = (pluginId: string): string =>
      plugins.find((bundle) => bundle.id === pluginId)?.revision ?? "0";
    return {
      apiVersion: state.data?.apiVersion ?? PLUGIN_UI_API_VERSION,
      plugins,
      views: plugins.flatMap((bundle) => bundle.views),
      docRenderers: plugins.flatMap((bundle) => bundle.docRenderers),
      pluginOf: (pluginId) => plugins.find((bundle) => bundle.id === pluginId) ?? null,
      viewComponent: (view) =>
        loadComponent({
          url: view.url,
          revision: revisionOf(view.pluginId),
          ticket,
          ...(view.export ? { export: view.export } : {}),
          assetUrl,
        }),
      docComponent: async (extension) => {
        const renderer = plugins
          .flatMap((bundle) => bundle.docRenderers)
          .find((item) => item.extensions.includes(extension));
        if (!renderer) return null;
        const Component = await loadComponent({
          url: renderer.url,
          revision: revisionOf(renderer.pluginId),
          ticket,
          ...(renderer.export ? { export: renderer.export } : {}),
          assetUrl,
        });
        return Component ? { pluginId: renderer.pluginId, Component } : null;
      },
    };
  }, [plugins, state.data?.apiVersion, assetUrl, ticket]);

  return (
    <RuntimeContextRef.Provider value={contextRef}>
      <PluginUiContext.Provider value={value}>{children}</PluginUiContext.Provider>
    </RuntimeContextRef.Provider>
  );
}

/** 取插件宿主；没有 Provider（子会话嵌套视图、测试）时返回 null，调用方按 `?.` 处理 */
export const usePluginUi = (): PluginUiHostValue | null => useContext(PluginUiContext);

/** 宿主上下文（会话 / 目录 / 语言）：插件组件的 props 由它算出来 */
export const usePluginUiHostInfo = (): PluginUiHostInfo | null =>
  useContext(RuntimeContextRef)?.current?.host ?? null;

/** 渲染一个插件视图：加载中给骨架，不可用给空态，渲染抛错交给边界 */
export function PluginViewSurface({ view, narrow }: { view: PluginUiView; narrow: boolean }) {
  const { t } = useTranslation();
  const host = usePluginUi();
  const hostInfo = usePluginUiHostInfo();
  const [state, setState] = useState<{ Component: PluginUiComponent | null } | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    void host?.viewComponent(view).then((Component) => {
      if (alive) setState({ Component });
    });
    return () => {
      alive = false;
    };
  }, [host, view]);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!state.Component) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty
          title={view.label}
          hint={t("插件的界面没有加载成功，去「设置 → 插件」看它的诊断。")}
        />
      </div>
    );
  }
  const Component = state.Component;
  return (
    <PluginBoundary label={view.label} hint={t("这个插件的界面出错了，刷新页面或重拉插件再试。")}>
      <Component
        host={{ ...(hostInfo ?? emptyHostInfo()), pluginId: view.pluginId }}
        narrow={narrow}
      />
    </PluginBoundary>
  );
}
/** 渲染接管某个文档的插件视图（编辑器区里 `.design` 这类） */
export function PluginDocSurface({ path, narrow }: { path: string; narrow: boolean }) {
  const { t } = useTranslation();
  const host = usePluginUi();
  const hostInfo = usePluginUiHostInfo();
  const extension = extensionOf(path);
  const [state, setState] = useState<{
    pluginId: string;
    Component: PluginUiComponent;
  } | null>(null);
  /** 加载失败：区分「没有插件接管」与「有接管但加载失败」 */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setState(null);
    setFailed(false);
    void host?.docComponent(extension).then((result) => {
      if (!alive) return;
      if (result) setState(result);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [host, extension]);

  if (!state) {
    if (!failed) {
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty title={path} hint={t("没有插件接管这种文件，或用它的插件没有启用。")} />
      </div>
    );
  }
  const { Component, pluginId } = state;
  return (
    <PluginBoundary label={path} hint={t("这个插件的界面出错了，刷新页面或重拉插件再试。")}>
      <Component
        host={{ ...(hostInfo ?? emptyHostInfo()), pluginId }}
        narrow={narrow}
        path={path}
      />
    </PluginBoundary>
  );
}

/** 没有会话上下文时的兜底：插件仍能渲染，只是拿不到会话与目录 */
const emptyHostInfo = (): PluginUiHostInfo => ({
  pluginId: "",
  sessionId: null,
  cwd: null,
  language: "zh-CN",
});

/**
 * 插件界面的错误边界：插件渲染抛错只吃掉它这一块，换成一句可读的说明。
 * 用 class 是因为 React 只支持类组件做错误边界。
 */
class PluginBoundary extends Component<
  { label: string; hint: string; children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { label: string; hint: string; children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("[plugin-ui] 插件界面渲染失败", this.props.label, error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty title={this.props.label} hint={this.props.hint} />
      </div>
    );
  }
}

/** 插件组件的导出形状约束：宿主组装时用它做编译期检查 */
export type PluginUiComponentType = ComponentType<PluginUiComponentProps>;
