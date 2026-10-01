/** 环境变量解析：由 APP_HOME 一个主目录派生工作目录与全部配置路径 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { appHomeDirname } from "@ucode/brand/values";

import {
  AGENT_DIRNAME,
  APP_DIRNAME,
  AUTH_FILENAME,
  CONFIG_FILENAME,
  DB_FILENAME,
  DEFAULT_POOL_IDLE_MS,
  DEFAULT_PORT,
  DEFAULT_PROMPT_SOURCE,
  LOG_LEVELS,
  PROMPT_SOURCES,
  type PromptSource,
  SESSIONS_DIRNAME,
  WORKSPACE_DIRNAME,
} from "./constants";

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
 * 下面按「谁的资产」分成两层：agent 的私有数据（auth / sessions）与
 * 应用自有数据（config.json / SQLite），互不混放。
 */
const homeDir = resolveDir(process.env.APP_HOME, resolve(homedir(), appHomeDirname));
const agentDir = resolve(homeDir, AGENT_DIRNAME);
const appDir = resolve(homeDir, APP_DIRNAME);
const workspaceRoot = resolve(homeDir, WORKSPACE_DIRNAME);
const isProduction = process.env.NODE_ENV === "production";

export const env = {
  repoRoot,
  isProduction,
  /** 工作与配置主目录 */
  homeDir,
  port: resolveNum(process.env.APP_PORT, DEFAULT_PORT),
  /** 助理根目录：未绑定工作目录的会话落在 `<workspaceRoot>/<sessionId>` */
  workspaceRoot,
  /** agent 数据目录：auth.json / sessions 放这里 */
  agentDir,
  /** 应用自有数据目录：config.json 与 SQLite 数据库 */
  appDir,
  /** 会话 JSONL 存放目录（保持扁平，便于统一列出） */
  sessionsRoot: resolve(agentDir, SESSIONS_DIRNAME),
  authPath: resolve(agentDir, AUTH_FILENAME),
  configPath: resolve(appDir, CONFIG_FILENAME),
  dbPath: resolve(appDir, DB_FILENAME),
  webDistDir: resolve(repoRoot, "apps/web/dist"),
  poolIdleMs: resolveNum(process.env.APP_POOL_IDLE_MS, DEFAULT_POOL_IDLE_MS),
  corsOrigin: process.env.APP_CORS_ORIGIN?.trim() || "*",
  logLevel: resolveLogLevel(process.env.APP_LOG_LEVEL, isProduction ? "info" : "debug"),
  /** 系统提示词源：`APP_PROMPT_SOURCE=pi|custom`，改它需要重启（会话装配时读取） */
  promptSource: resolvePromptSource(process.env.APP_PROMPT_SOURCE),
};

for (const dir of new Set([
  env.homeDir,
  env.workspaceRoot,
  env.agentDir,
  env.appDir,
  env.sessionsRoot,
])) {
  mkdirSync(dir, { recursive: true });
}
