/**
 * 插件服务端模块的契约：宿主交给它什么、它交回什么。
 *
 * 为什么服务端代码也要走「插件自带产物 + 宿主注入能力」这条路：
 * - 插件目录在 `$APP_HOME/plugins/cache/…` 或随包资源里，从那里解析不到宿主的 `node_modules`，
 *   所以 pi 的 `defineTool` / 图片处理这类宿主能力必须**以参数传进去**，插件不直接 import 它们；
 * - 反过来，插件能做的就只是「拿到的这几样」：自己的数据目录、会话状态、事件、日志、只读会话信息。
 *   没有 services、没有数据库句柄，插件碰不到内核。
 *
 * 生命周期：进程内**一份**（按插件 id 缓存），`activate` 只跑一次；路由与工具在需要时按会话取。
 */
import type { PluginAgentFile } from "./types";

/** 会话在插件眼里的样子：只有排障与落盘需要的那几项 */
export type PluginServerSession = {
  id: string;
  /** 会话工作目录：插件产出的文件落在它下面 */
  cwd: string;
  /** 会话标题；还没起名时为 null（插件按它给文件取名时要容错） */
  name: string | null;
};

/** 插件自己的会话级键值状态：设计稿指针这类「插件自有、要跨重启」的数据放这里 */
export type PluginServerSessionState = {
  get: (sessionId: string, key: string) => string | null;
  /** 写一个键；`value` 为 null 表示删除 */
  set: (sessionId: string, key: string, value: string | null) => void;
  /** 该插件在全部会话里的某个键：算「默认落点要避开哪些」这类全量口径用 */
  list: (key: string) => Array<{ sessionId: string; value: string }>;
};

/** 宿主提供的最小能力面 */
export type PluginServerPi = {
  /** pi 的工具定义工厂：插件产物解析不到宿主依赖，只能由宿主传进来 */
  defineTool: (definition: unknown) => unknown;
  resizeImage: (bytes: Uint8Array, mimeType: string, options?: unknown) => Promise<unknown>;
  detectSupportedImageMimeTypeFromFile: (path: string) => Promise<string | null>;
};

export type PluginServerContext = {
  readonly pluginId: string;
  /** 插件持久数据目录（`$APP_HOME/plugins/data/<id>`），跨版本保留 */
  readonly dataDir: string;
  /** 用户在插件卡片里填的 `userConfig` 值（已按清单声明校验过类型） */
  readonly config: Record<string, string | number | boolean>;
  readonly logger: {
    info: (message: string, meta?: unknown) => void;
    warn: (message: string, meta?: unknown) => void;
    error: (message: string, meta?: unknown) => void;
  };
  readonly sessions: {
    find: (sessionId: string) => PluginServerSession | null;
    /** 插件声明的子角色（已加插件前缀）；供插件自己的提示词或界面展示 */
    readonly agents: readonly PluginAgentFile[];
  };
  readonly sessionState: PluginServerSessionState;
  /** 下发插件自有事件：宿主按 `pluginId` 转给对应插件的界面（`plugin_event` 帧） */
  readonly events: {
    emit: (sessionId: string, type: string, payload?: unknown) => void;
  };
  readonly pi: PluginServerPi;
};

/** 插件服务端模块的导出（`manifest.server` 指向的文件） */
export type PluginServerModule = {
  /** 首次加载后跑一次：建索引、清临时文件这类准备工作 */
  activate?: (ctx: PluginServerContext) => void | Promise<void>;
  /**
   * 插件自有接口：宿主把 `/api/v1/plugins/<id>/api/*` 的请求原样转给它。
   * 返回带 `fetch(request)` 的对象（Hono 应用就满足）；返回 null 表示这个插件没有接口。
   */
  createRoutes?: (
    ctx: PluginServerContext,
  ) => { fetch: (request: Request) => Response | Promise<Response> } | null;
  /**
   * 会话装配时取工具：宿主按本次会话实际可用的工具名过滤后注册。
   * 返回 `ToolDefinition[]`（本层不引 pi 的类型，装配层自己收窄）。
   */
  createTools?: (ctx: PluginServerContext, input: { sessionId: string; cwd: string }) => unknown[];
};
