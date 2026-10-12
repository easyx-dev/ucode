/**
 * 环境变量解析：配置一律来自环境变量（.env / .env.prod），由 APP_HOME 派生全部路径；缺失即报错退出。
 *
 * 环境文件的定位与加载也在这里（它只服务本模块）：先按 `NODE_ENV` 选文件名、从 cwd 向上找到它并加载，
 * 再读值、校验、派生路径。
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  APP_DIRNAME,
  ATTACHMENTS_DIRNAME,
  AUTH_FILENAME,
  BUILTIN_DIRNAME,
  CONFIG_FILENAME,
  DB_FILENAME,
  HARNESS_DIRNAME,
  MCP_CONFIG_FILENAME,
  PLUGIN_STATE_FILENAME,
  PLUGINS_DIRNAME,
  SERVICE_FILENAME,
  SESSIONS_DIRNAME,
  WORKSPACE_DIRNAME,
} from "./constants/dirs";
import { LOG_LEVELS, PROMPT_SOURCES, type PromptSource } from "./constants/env";
import { expandHome } from "./platform/paths";
import { resourceRoot } from "./platform/resources";
import { readServiceRegistration } from "./platform/service-registration";

/** 当前应加载的环境文件名：生产 `.env.prod`，其余 `.env`（按 NODE_ENV 选择） */
const envFileName = (): string => (process.env.NODE_ENV === "production" ? ".env.prod" : ".env");

/** 从 start 向上查找指定环境文件，返回其绝对路径；找不到返回 undefined */
const findEnvFile = (start: string, fileName: string): string | undefined => {
  let current = start;
  for (;;) {
    const candidate = resolve(current, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/** 加载环境文件前 process.env 里已有的键（CLI 参数 / shell 变量），用于区分「显式设置」与「.env 默认」 */
let presetKeys: ReadonlySet<string> = new Set();

/** 该变量是否在加载环境文件前就已显式设置（区别 `.env` 注入的默认值） */
const wasPreset = (name: string): boolean => presetKeys.has(name);

/**
 * 加载从 cwd 向上的环境文件，返回相对路径的解析基准（文件所在目录，无则 cwd）。
 *
 * 基准取环境文件所在目录而非仓库根：`APP_HOME` 常写成相对路径（如开发模板里的 `.tmp/<品牌>`），
 * 只有相对它解析，在仓库内运行才能落到预期目录。
 */
const loadEnvFile = (): string => {
  // 先快照：CLI 参数（--host/--port）与 shell 变量在加载环境文件前就已就位，
  // 后续取值要靠它把「显式设置」与「.env 声明的默认值」区分开
  presetKeys = new Set(Object.keys(process.env));

  const envFile = findEnvFile(process.cwd(), envFileName());
  if (envFile) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // 环境文件存在但不可读时按未设置处理，缺失项由下面的校验兜底
    }
    return dirname(envFile);
  }
  return process.cwd();
};

/** 相对路径的解析基准：环境文件所在目录（无则 cwd） */
const baseDir = loadEnvFile();
/** 当前加载的环境文件名，用于缺失 / 非法项的错误提示 */
const envFile = envFileName();

/**
 * 启动期配置缺失 / 非法：logger 依赖 env 尚不可用，故直接写 stderr 并退出。
 * 显式失败优于带默认值静默跑起来——生产与开发的差异都应由环境变量声明。
 */
const die = (message: string): never => {
  console.error(`[配置错误] ${message}`);
  console.error(`请在 ${envFile} 或运行环境中声明（模板见 .env.example 与 .env.prod.example）。`);
  process.exit(1);
};

const requireEnv = (name: string): string => {
  const raw = process.env[name]?.trim();
  return raw ? raw : die(`缺少环境变量 ${name}`);
};

const requireNum = (name: string): number => {
  const raw = requireEnv(name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : die(`环境变量 ${name} 非法：${raw}`);
};

/** 非法级别会让 pino 在构造时抛错、直接拖垮启动，所以这里只接受白名单内的值 */
const resolveLogLevel = (): string => {
  const raw = requireEnv("APP_LOG_LEVEL").toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw)
    ? raw
    : die(`APP_LOG_LEVEL 非法：${raw}（可选 ${LOG_LEVELS.join(" / ")}）`);
};

/** 提示词源同样只接受白名单，写错时明确报错而不是让会话装配在运行期才炸 */
const resolvePromptSource = (): PromptSource => {
  const raw = requireEnv("APP_PROMPT_SOURCE").toLowerCase();
  return (PROMPT_SOURCES as readonly string[]).includes(raw)
    ? (raw as PromptSource)
    : die(`APP_PROMPT_SOURCE 非法：${raw}（可选 ${PROMPT_SOURCES.join(" / ")}）`);
};

/** APP_HOME 支持 `~` 与相对路径（相对环境文件所在目录） */
const resolveAppHome = (): string => {
  const expanded = expandHome(requireEnv("APP_HOME"));
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
};

const homeDir = resolveAppHome();
const harnessDir = resolve(homeDir, HARNESS_DIRNAME);
const appDir = resolve(homeDir, APP_DIRNAME);
const workspacesDir = resolve(homeDir, WORKSPACE_DIRNAME);
const isProduction = process.env.NODE_ENV === "production";

/** 服务注册文件里的端口是「上次落地的监听形态」；`APP_HOST` / `APP_PORT` 在 .env 里是默认值 */
const servicePath = resolve(appDir, SERVICE_FILENAME);
const registration = readServiceRegistration(servicePath);

const parsePort = (raw: string, source: string): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : die(`${source} 非法：${raw}`);
};

/** 端口：显式（--port / shell）> `.env` 声明的默认值；`service.json` 仅在未声明时兜底（端口没有设置入口） */
const resolvePort = (): number => {
  if (wasPreset("APP_PORT")) {
    const explicit = process.env.APP_PORT?.trim();
    if (explicit) return parsePort(explicit, "APP_PORT（显式）");
  }
  const declared = process.env.APP_PORT?.trim();
  if (declared) return parsePort(declared, "APP_PORT");
  if (registration && registration.port > 0) return registration.port;
  return die("缺少 APP_PORT，且没有可复用的 service.json 端口");
};

/** 监听地址同理：显式 > service.json > .env 默认；设置里的局域网开关据此在重启后生效 */
const resolveHost = (): string => {
  const explicit = wasPreset("APP_HOST") ? process.env.APP_HOST?.trim() : undefined;
  return explicit || registration?.host?.trim() || requireEnv("APP_HOST");
};

export const env = {
  /** 资源根（仓库根）：web 产物、package.json 等定位基准 */
  resourceRoot,
  isProduction,
  /** 工作与配置主目录 */
  homeDir,
  /** 监听地址与端口（端口 0 表示自选，启动后回写注册文件） */
  host: resolveHost(),
  port: resolvePort(),
  /** 服务注册文件：host / port / pid / serviceToken / password（0600，服务独占写） */
  servicePath,
  /** 助理根目录：未绑定工作目录的会话落在 `<workspacesDir>/<sessionId>` */
  workspacesDir,
  /** 运行时数据目录：auth.json / sessions 放这里 */
  harnessDir,
  /** 应用自有数据目录：config.json 与 SQLite 数据库 */
  appDir,
  /** 附件库：按内容 sha256 存的原始字节，图片与文档共用 */
  attachmentsDir: resolve(appDir, ATTACHMENTS_DIRNAME),
  /** 会话 JSONL 存放目录（保持扁平，便于统一列出） */
  sessionsDir: resolve(harnessDir, SESSIONS_DIRNAME),
  authPath: resolve(harnessDir, AUTH_FILENAME),
  configPath: resolve(appDir, CONFIG_FILENAME),
  /** pi 的 MCP 服务器配置（用户级）；设置页增删改写回这里 */
  mcpConfigPath: resolve(harnessDir, MCP_CONFIG_FILENAME),
  /** 插件根：市场清单缓存、安装副本与插件数据目录 */
  pluginsDir: resolve(homeDir, PLUGINS_DIRNAME),
  /** 插件状态文件：登记表 + 用户配置 + 注册表代次（0600） */
  pluginStatePath: resolve(appDir, PLUGIN_STATE_FILENAME),
  /** 内置资产物化目录：随包技能真身与 manifest.json */
  builtinDir: resolve(appDir, BUILTIN_DIRNAME),
  dbPath: resolve(appDir, DB_FILENAME),
  /** web 构建产物（由 pnpm build 生成，server 同源托管） */
  webDistDir: resolve(resourceRoot, "apps/web/dist"),
  poolIdleMs: requireNum("APP_POOL_IDLE_MS"),
  corsOrigin: process.env.APP_CORS_ORIGIN?.trim() || "",
  logLevel: resolveLogLevel(),
  /** 系统提示词源：`APP_PROMPT_SOURCE=pi|custom`，改它需要重启（会话装配时读取） */
  promptSource: resolvePromptSource(),
};

for (const dir of new Set([
  env.homeDir,
  env.workspacesDir,
  env.harnessDir,
  env.appDir,
  env.sessionsDir,
  env.pluginsDir,
  env.builtinDir,
])) {
  mkdirSync(dir, { recursive: true });
}
