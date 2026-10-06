/** 环境变量解析：由 APP_HOME 一个主目录派生工作目录与全部配置路径 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { appHomeDirname } from "@ucode/brand/values";

import {
  APP_DIRNAME,
  ATTACHMENTS_DIRNAME,
  AUTH_FILENAME,
  CONFIG_FILENAME,
  DB_FILENAME,
  DEFAULT_HOST,
  DEFAULT_POOL_IDLE_MS,
  DEFAULT_PORT,
  DEFAULT_PROMPT_SOURCE,
  HARNESS_DIRNAME,
  LOG_LEVELS,
  MCP_CONFIG_FILENAME,
  PROMPT_SOURCES,
  type PromptSource,
  SERVICE_FILENAME,
  SESSIONS_DIRNAME,
  WORKSPACE_DIRNAME,
} from "./constants";
import { readServiceRegistration } from "./lib/service-file";

const repoRoot = resolve(import.meta.dirname, "../..");

try {
  process.loadEnvFile(resolve(repoRoot, ".env"));
} catch {
  // 没有 .env 时全部使用默认值
}

const resolveDir = (value: string | undefined, fallback: string): string => {
  const raw = value?.trim() || fallback;
  return isAbsolute(raw) ? raw : resolve(repoRoot, raw);
};

const resolveNum = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** 非法级别会让 pino 在构造时抛错、直接拖垮启动，所以这里只接受白名单内的值 */
const resolveLogLevel = (value: string | undefined, fallback: string): string => {
  const raw = value?.trim().toLowerCase();
  return raw && (LOG_LEVELS as readonly string[]).includes(raw) ? raw : fallback;
};

/** 提示词源同样只接受白名单，写错时回落默认而不是让会话装配在运行期才炸 */
const resolvePromptSource = (value: string | undefined): PromptSource => {
  const raw = value?.trim().toLowerCase();
  return raw && (PROMPT_SOURCES as readonly string[]).includes(raw)
    ? (raw as PromptSource)
    : DEFAULT_PROMPT_SOURCE;
};

/**
 * 应用主目录，同时是 agent 的工作目录。
 * 默认落在用户主目录下（`~/` + `appHomeDirname`），可用 `APP_HOME` 指向别处。
 * 下面按「谁的资产」分成两层：运行时私有数据（auth / sessions）与
 * 应用自有数据（config.json / SQLite），互不混放。
 */
const homeDir = resolveDir(process.env.APP_HOME, resolve(homedir(), appHomeDirname));
const harnessDir = resolve(homeDir, HARNESS_DIRNAME);
const appDir = resolve(homeDir, APP_DIRNAME);
const workspaceRoot = resolve(homeDir, WORKSPACE_DIRNAME);
const isProduction = process.env.NODE_ENV === "production";

/**
 * 服务注册文件里的 host / port 是「上次落地的监听形态」；
 * 优先级为 显式 env > service.json > 默认，所以没设 APP_PORT 的普通重启会复用上次端口。
 */
const servicePath = resolve(appDir, SERVICE_FILENAME);
const registration = readServiceRegistration(servicePath);
const explicitPort = process.env.APP_PORT?.trim();

const resolvePort = (): number => {
  if (explicitPort) {
    const parsed = Number(explicitPort);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return registration && registration.port > 0 ? registration.port : DEFAULT_PORT;
};

export const env = {
  repoRoot,
  isProduction,
  /** 工作与配置主目录 */
  homeDir,
  /** 监听地址：默认仅回环，`APP_HOST=0.0.0.0` 才允许局域网 */
  host: process.env.APP_HOST?.trim() || registration?.host || DEFAULT_HOST,
  port: resolvePort(),
  /** 服务注册文件：host / port / serviceToken / password（0600，服务独占写） */
  servicePath,
  /** 助理根目录：未绑定工作目录的会话落在 `<workspaceRoot>/<sessionId>` */
  workspaceRoot,
  /** 运行时数据目录：auth.json / sessions 放这里 */
  harnessDir,
  /** 应用自有数据目录：config.json 与 SQLite 数据库 */
  appDir,
  /** 附件库：按内容 sha256 存的原始字节，图片与文档共用 */
  attachmentsDir: resolve(appDir, ATTACHMENTS_DIRNAME),
  /** 会话 JSONL 存放目录（保持扁平，便于统一列出） */
  sessionsRoot: resolve(harnessDir, SESSIONS_DIRNAME),
  authPath: resolve(harnessDir, AUTH_FILENAME),
  configPath: resolve(appDir, CONFIG_FILENAME),
  /** pi 的 MCP 服务器配置（用户级）；设置页增删改写回这里 */
  mcpConfigPath: resolve(harnessDir, MCP_CONFIG_FILENAME),
  dbPath: resolve(appDir, DB_FILENAME),
  webDistDir: resolve(repoRoot, "apps/web/dist"),
  poolIdleMs: resolveNum(process.env.APP_POOL_IDLE_MS, DEFAULT_POOL_IDLE_MS),
  corsOrigin: process.env.APP_CORS_ORIGIN?.trim() || "",
  logLevel: resolveLogLevel(process.env.APP_LOG_LEVEL, isProduction ? "info" : "debug"),
  /** 系统提示词源：`APP_PROMPT_SOURCE=pi|custom`，改它需要重启（会话装配时读取） */
  promptSource: resolvePromptSource(process.env.APP_PROMPT_SOURCE),
};

for (const dir of new Set([
  env.homeDir,
  env.workspaceRoot,
  env.harnessDir,
  env.appDir,
  env.sessionsRoot,
])) {
  mkdirSync(dir, { recursive: true });
}
