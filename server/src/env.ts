/**
 * 环境变量解析：配置一律来自环境变量（.env / .env.prod），由 APP_HOME 派生全部路径；缺失即报错退出。
 *
 * 环境文件的定位与加载、APP_HOME 的取值在 `platform/app-home`（CLI 的 `service` 子命令也要用，
 * 而它不该被端口 / 日志级别这类缺失拦住）；这里在其之上读值、校验、派生其余路径。
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATTACHMENTS_DIRNAME,
  AUTH_FILENAME,
  BUILTIN_DIRNAME,
  CONFIG_FILENAME,
  DB_FILENAME,
  HARNESS_DIRNAME,
  MCP_CONFIG_FILENAME,
  PLUGIN_STATE_FILENAME,
  PLUGINS_DIRNAME,
  SESSIONS_DIRNAME,
  WORKSPACE_DIRNAME,
} from "./constants/dirs";
import { LOG_LEVELS, PROMPT_SOURCES, type PromptSource } from "./constants/env";
import { dieConfig, loadAppHome } from "./platform/app-home";
import { resourceRoot } from "./platform/resources";
import { readServiceRegistration } from "./platform/service-registration";

const requireEnv = (name: string): string => {
  const raw = process.env[name]?.trim();
  return raw ? raw : dieConfig(`缺少环境变量 ${name}`);
};

const requireNum = (name: string): number => {
  const raw = requireEnv(name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : dieConfig(`环境变量 ${name} 非法：${raw}`);
};

/** 非法级别会让 pino 在构造时抛错、直接拖垮启动，所以这里只接受白名单内的值 */
const resolveLogLevel = (): string => {
  const raw = requireEnv("APP_LOG_LEVEL").toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw)
    ? raw
    : dieConfig(`APP_LOG_LEVEL 非法：${raw}（可选 ${LOG_LEVELS.join(" / ")}）`);
};

/** 提示词源同样只接受白名单，写错时明确报错而不是让会话装配在运行期才炸 */
const resolvePromptSource = (): PromptSource => {
  const raw = requireEnv("APP_PROMPT_SOURCE").toLowerCase();
  return (PROMPT_SOURCES as readonly string[]).includes(raw)
    ? (raw as PromptSource)
    : dieConfig(`APP_PROMPT_SOURCE 非法：${raw}（可选 ${PROMPT_SOURCES.join(" / ")}）`);
};

/** 主目录 / 应用目录 / 注册文件路径由 `platform/app-home` 定下（CLI 也要用同一份） */
const { homeDir, appDir, servicePath, wasPreset } = loadAppHome();
const harnessDir = resolve(homeDir, HARNESS_DIRNAME);
const workspacesDir = resolve(homeDir, WORKSPACE_DIRNAME);
const isProduction = process.env.NODE_ENV === "production";

const registration = readServiceRegistration(servicePath);

const parsePort = (raw: string, source: string): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : dieConfig(`${source} 非法：${raw}`);
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
  return dieConfig("缺少 APP_PORT，且没有可复用的 service.json 端口");
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
