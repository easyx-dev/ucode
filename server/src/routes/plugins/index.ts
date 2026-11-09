/**
 * /api/v1/plugins：插件登记表的读写（安装 / 启停 / 卸载 / 重拉）、界面贡献清单与模块托管。
 *
 * 托管的两类响应**不走封套**（模块与样式是发给浏览器的源码，不是接口数据）：这是 `docs/api.md`
 * 里记的刻意例外，与附件字节同一性质。
 *
 * 托管的模块只做一件事：把裸模块名（`@ucode/plugin-api` / `react` / `react/jsx-runtime`）改写成
 * 宿主运行时 shim 的地址。改写在服务端做而不是靠 import map——四种形态（源码运行、打包产物、
 * 桌面端的 `app://`、中继的路径前缀）都能落在同一条路上，插件内部的相对 import 也照常工作。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import {
  API_BASE_PATH,
  ERROR_CODES,
  type PluginDeleteResponse,
  type PluginsListResponse,
  type PluginsUiResponse,
  type PluginWriteResponse,
  pluginCreateInputSchema,
  pluginDeleteInputSchema,
  pluginListInputSchema,
  pluginRefreshInputSchema,
  pluginUiInputSchema,
  pluginUpdateInputSchema,
} from "@ucode/contracts";
import { type Context, Hono } from "hono";

import { HUB_BASE_PATH_HEADER } from "../../constants/hub";
import { assertComponentPath } from "../../harness/plugins/components";
import { PLUGIN_RUNTIME_SPECIFIERS, pluginRuntimeShim } from "../../harness/plugins/ui-runtime";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";

const SCRIPT_TYPE = "text/javascript; charset=utf-8";
const STYLE_TYPE = "text/css; charset=utf-8";

/** 挂载前缀（中继的 `/d/<设备 id>`）：改写出的 shim 地址必须是站内绝对路径 */
const basePathOf = (c: Context): string => {
  const raw = (c.req.header(HUB_BASE_PATH_HEADER) ?? "").replace(/\/+$/, "");
  return /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(raw) ? raw : "";
};

/**
 * 把裸模块名改写成 shim 地址。
 * 三种写法都要覆盖：`from "x"`、副作用 `import "x"`、动态 `import("x")`——插件作者用哪种都行。
 */
const rewriteSpecifiers = (source: string, runtimeBase: string, ticket: string): string => {
  let text = source;
  for (const [specifier, file] of Object.entries(PLUGIN_RUNTIME_SPECIFIERS)) {
    // shim 与模块同一张票：它们都是浏览器直接取的内容，带不了 Authorization
    const target = `${runtimeBase}/plugins/runtime/${file}${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ""}`;
    const quoted = [`"${specifier}"`, `'${specifier}'`];
    for (const raw of quoted) {
      text = text.replaceAll(`from ${raw}`, `from "${target}"`);
      text = text.replaceAll(`import ${raw}`, `import "${target}"`);
      text = text.replaceAll(`import(${raw})`, `import("${target}")`);
    }
  }
  return text;
};

/** 稳定 ETag：同一份内容同一个值，内容变了浏览器自然会重取（`Cache-Control: no-cache`） */
const etagOf = (text: string): string =>
  `W/"${createHash("sha1").update(text).digest("hex").slice(0, 16)}"`;

/** 一条托管响应：文本 + 类型 + 弱 ETag；命中 If-None-Match 就回 304 */
const textResponse = (c: Context, text: string, contentType: string): Response => {
  const etag = etagOf(text);
  if (c.req.header("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { etag } });
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": contentType,
      etag,
      // 必须每次回源校验：URL 里带了 revision，正常情况下浏览器缓存已经能挡住重复取用
      "cache-control": "no-cache",
    },
  });
};

/** 按后缀判响应类型；托管的文件只可能是这两种 */
const contentTypeOf = (path: string): string | null => {
  const extension = extname(path).toLowerCase();
  if (extension === ".mjs" || extension === ".js") return SCRIPT_TYPE;
  if (extension === ".css") return STYLE_TYPE;
  return null;
};

export const createPluginsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(pluginListInputSchema), (c) => {
    const response: PluginsListResponse = services.plugins.list(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/create", jsonBody(pluginCreateInputSchema), async (c) => {
    const response: PluginWriteResponse = await services.plugins.create(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/update", jsonBody(pluginUpdateInputSchema), (c) => {
    const response: PluginWriteResponse = services.plugins.update(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/delete", jsonBody(pluginDeleteInputSchema), (c) => {
    const response: PluginDeleteResponse = services.plugins.delete(c.req.valid("json"));
    return c.json(ok(response));
  });

  router.post("/refresh", jsonBody(pluginRefreshInputSchema), async (c) => {
    const response: PluginWriteResponse = await services.plugins.refresh(c.req.valid("json"));
    return c.json(ok(response));
  });

  /** 界面贡献清单：启用且受信任的插件，供渲染层宿主装配 */
  router.post("/ui", jsonBody(pluginUiInputSchema), (c) => {
    const response: PluginsUiResponse = services.plugins.ui(c.req.valid("json"));
    return c.json(ok(response));
  });

  /**
   * 宿主运行时 shim。放在 `:id/ui/*` 之前不必要（路径段数不同），但顺序上先给 shim 更直观：
   * 它没有任何插件上下文，只是一段固定源码。
   */
  router.get("/runtime/:name", (c) => {
    const name = c.req.param("name");
    const shim = pluginRuntimeShim(name);
    if (!shim) throw new AppError(ERROR_CODES.notFound, `没有这个运行时模块：${name}`, 404);
    return textResponse(c, shim, SCRIPT_TYPE);
  });

  /**
   * 插件模块与样式的托管：`<id>/ui/<相对路径>`。
   *
   * 路径两道校验：插件必须是启用且受信任的（`uiRootOf`），文件必须落在插件根内
   * （`assertComponentPath` 挡住 `../` 与符号链接逃逸）。
   */
  router.get("/:id/ui/:rest{.+}", (c) => {
    const pluginId = c.req.param("id");
    const root = services.plugins.uiRootOf(undefined, pluginId);
    if (!root) {
      throw new AppError(ERROR_CODES.pluginUiUnavailable, `插件界面不可用：${pluginId}`, 404);
    }
    const relative = c.req.param("rest");
    if (!relative) throw new AppError(ERROR_CODES.notFound, "缺少模块路径", 404);

    let file: string;
    try {
      file = assertComponentPath(root, `./${relative}`);
    } catch (error) {
      throw error instanceof AppError
        ? error
        : new AppError(ERROR_CODES.pluginComponentInvalid, String(error), 400);
    }
    const contentType = contentTypeOf(relative);
    if (!contentType) {
      throw new AppError(
        ERROR_CODES.pluginComponentInvalid,
        `托管只认 .mjs / .js / .css：${relative}`,
        400,
      );
    }

    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new AppError(ERROR_CODES.notFound, `模块不存在：${relative}`, 404);
    }
    const body =
      contentType === SCRIPT_TYPE
        ? rewriteSpecifiers(text, `${basePathOf(c)}${API_BASE_PATH}`, c.req.query("ticket") ?? "")
        : text;
    return textResponse(c, body, contentType);
  });

  /**
   * 插件自有接口：`<id>/api/*` 原样转给插件的服务端模块（它自己 new 一个 Hono）。
   * 用 `router.all` 而不是逐个方法注册：路径与语义都属于插件，宿主管不了也不该管；
   * 鉴权照旧（这批请求在 `/api/v1` 下，走同一套中间件）。
   */
  router.all("/:id/api/*", async (c) => {
    const pluginId = c.req.param("id");
    const raw = c.req.raw;
    // 插件看到的是自己根下的路径（`/ping`），不是宿主的完整路径：转交前把前缀剥掉
    const rest = /\/plugins\/[^/]+\/api\/(.*)$/.exec(c.req.path)?.[1] ?? "";
    const url = new URL(raw.url);
    const target = new URL(`/${rest}${url.search}`, url.origin);
    const hasBody = raw.method !== "GET" && raw.method !== "HEAD";
    const request = new Request(target, {
      method: raw.method,
      headers: raw.headers,
      ...(hasBody ? { body: raw.body, duplex: "half" as const } : {}),
    });
    const response = await services.plugins.handleRoute(pluginId, request);
    if (!response) {
      throw new AppError(ERROR_CODES.pluginUiUnavailable, `插件接口不可用：${pluginId}`, 404);
    }
    return response;
  });

  return router;
};
