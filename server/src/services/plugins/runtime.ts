/**
 * 插件服务端模块的加载与调用：进程内一份、按插件 id 缓存，来源门控与界面同一档。
 *
 * 几个刻意的取舍：
 * - **动态 import 且带缓存键**：键是「文件路径 + mtime」，插件重拉后文件变了就重新加载，
 *   不需要重启服务；同一个键只 activate 一次。
 * - **失败不炸进程**：加载 / 激活抛错只出诊断并返回 null，插件的界面照样能装（只是没有数据）。
 * - **不给插件句柄**：传进去的是 `PluginServerContext`（会话状态、事件、日志、自己的数据目录），
 *   没有 services、没有数据库、没有会话池。
 */
import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  defineTool,
  detectSupportedImageMimeTypeFromFile,
  resizeImage,
} from "@earendil-works/pi-coding-agent";
import type {
  PluginServerContext,
  PluginServerModule,
  PluginServerPi,
} from "../../harness/plugins/server-runtime";
import type { PluginDescriptor } from "../../harness/plugins/types";
import { logger } from "../../platform/logger";

const MODULE = "plugins.runtime";

/** 交给插件的 pi 能力：只这三样，够工具定义与图片归一化 */
const PI_HELPERS: PluginServerPi = {
  // 这三样在插件侧只有「形状」要求（插件产物里没有 pi 的类型），边界上按 unknown 收窄
  defineTool: (definition) => defineTool(definition as never) as unknown,
  resizeImage: (bytes, mimeType, options) =>
    resizeImage(bytes, mimeType, options as never) as Promise<unknown>,
  detectSupportedImageMimeTypeFromFile,
};

/** 一个插件的加载态 */
type Loaded = {
  key: string;
  module: PluginServerModule;
  routes: { fetch: (request: Request) => Response | Promise<Response> } | null;
};

/** 缓存键：路径 + mtime，插件产物换了就换键（旧模块留在内存里等 GC，不主动卸载） */
const keyOf = (file: string): string => {
  const stats = statSync(file);
  return `${file}:${stats.mtimeMs}:${stats.size}`;
};

export type PluginRuntimeDeps = {
  /** 造上下文：会话状态、事件、数据目录都由服务层给，运行时不碰这些实现 */
  contextOf: (descriptor: PluginDescriptor) => PluginServerContext;
};

export type PluginRuntime = {
  /** 取服务端模块；没声明 `server`、未受信任、加载失败都返回 null */
  moduleOf: (descriptor: PluginDescriptor) => Promise<Loaded | null>;
  /** 插件自有接口入口；没有就返回 null（路由据此 404） */
  handle: (descriptor: PluginDescriptor, request: Request) => Promise<Response | null>;
  /** 会话装配用的工具；插件没声明或没工具时是空数组 */
  toolsOf: (
    descriptor: PluginDescriptor,
    input: { sessionId: string; cwd: string },
  ) => Promise<unknown[]>;
};

export const createPluginRuntime = (deps: PluginRuntimeDeps): PluginRuntime => {
  const loaded = new Map<string, Loaded>();

  const load = async (descriptor: PluginDescriptor): Promise<Loaded | null> => {
    const entry = descriptor.components.find(
      (component) => component.group === "server" && component.path,
    );
    if (!entry?.path) return null;
    // 门控：第三方市场的服务端模块不加载（与界面、hooks、扩展同一档）
    if (descriptor.source === "market") return null;

    let key: string;
    try {
      key = keyOf(entry.path);
    } catch {
      logger.warn({ module: MODULE, plugin: descriptor.id }, "插件服务端模块不存在");
      return null;
    }

    const cached = loaded.get(descriptor.id);
    if (cached && cached.key === key) return cached;

    try {
      const namespace = (await import(
        `${pathToFileURL(entry.path).href}?v=${encodeURIComponent(key)}`
      )) as Partial<PluginServerModule> | { default?: Partial<PluginServerModule> };
      const module: PluginServerModule =
        "createRoutes" in namespace || "createTools" in namespace || "activate" in namespace
          ? (namespace as PluginServerModule)
          : ((namespace as { default?: PluginServerModule }).default ?? {});
      const context = deps.contextOf(descriptor);
      await module.activate?.(context);
      const routes = module.createRoutes?.(context) ?? null;
      const record: Loaded = { key, module, routes };
      loaded.set(descriptor.id, record);
      logger.info(
        { module: MODULE, plugin: descriptor.id, routes: routes !== null },
        "插件服务端模块已加载",
      );
      return record;
    } catch (error) {
      logger.error(
        { module: MODULE, plugin: descriptor.id, error: String(error) },
        "插件服务端模块加载失败",
      );
      return null;
    }
  };

  return {
    moduleOf: load,
    async handle(descriptor, request) {
      const record = await load(descriptor);
      if (!record?.routes) return null;
      try {
        return await record.routes.fetch(request);
      } catch (error) {
        logger.error(
          { module: MODULE, plugin: descriptor.id, error: String(error) },
          "插件接口处理失败",
        );
        return new Response("插件接口处理失败", { status: 500 });
      }
    },
    async toolsOf(descriptor, input) {
      const record = await load(descriptor);
      if (!record?.module.createTools) return [];
      try {
        return record.module.createTools(deps.contextOf(descriptor), input);
      } catch (error) {
        logger.error(
          { module: MODULE, plugin: descriptor.id, error: String(error) },
          "插件工具创建失败",
        );
        return [];
      }
    },
  };
};

export { PI_HELPERS };
