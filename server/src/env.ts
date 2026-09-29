/** 环境变量解析：由 APP_HOME 一个主目录派生工作目录与全部配置路径 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { appHomeDirname } from "@ucode/brand/values";

import {
  APP_DIRNAME,
  AUTH_FILENAME,
  CONFIG_FILENAME,
  DB_FILENAME,
  DEFAULT_DRAFT_TTL_MS,
  DEFAULT_POOL_IDLE_MS,
  DEFAULT_PORT,
  LOG_LEVELS,
  PI_DIRNAME,
  SESSIONS_DIRNAME,
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

/**
 * 应用主目录，同时是 agent 的工作目录。
 * 默认落在用户主目录下（`~/` + `appHomeDirname`），可用 `APP_HOME` 指向别处。
 * 下面按「谁的资产」分成两层：pi 的私有数据（auth / sessions）与
 * 应用自有数据（config.json / SQLite），互不混放。
 */
const homeDir = resolveDir(process.env.APP_HOME, resolve(homedir(), appHomeDirname));
const piDir = resolve(homeDir, PI_DIRNAME);
const appDir = resolve(homeDir, APP_DIRNAME);
const isProduction = process.env.NODE_ENV === "production";

/**
 * 旧布局标记：`agent/` 或根目录下的 `config.json` / `session-state.json`。
 * 只用于启动提示，不做迁移——这些路径不会被读取。
 */
const legacyLayout =
  !existsSync(piDir) &&
  ["config.json", "session-state.json", "agent"].some((name) => existsSync(resolve(homeDir, name)));

export const env = {
  repoRoot,
  isProduction,
  /** 工作与配置主目录 */
  homeDir,
  port: resolveNum(process.env.APP_PORT, DEFAULT_PORT),
  /** agent 的工作目录（工具读写文件、会话分组） */
  workspaceDir: homeDir,
  /** pi 私有数据目录：auth.json / sessions 放这里 */
  piDir,
  /** 应用自有数据目录：config.json 与 SQLite 数据库 */
  appDir,
  /** 是否检测到旧布局（仅在启动日志提示，不迁移） */
  legacyLayout,
  /** 会话 JSONL 存放目录（保持扁平，便于统一列出） */
  sessionsRoot: resolve(piDir, SESSIONS_DIRNAME),
  authPath: resolve(piDir, AUTH_FILENAME),
  configPath: resolve(appDir, CONFIG_FILENAME),
  dbPath: resolve(appDir, DB_FILENAME),
  webDistDir: resolve(repoRoot, "apps/web/dist"),
  poolIdleMs: resolveNum(process.env.APP_POOL_IDLE_MS, DEFAULT_POOL_IDLE_MS),
  draftTtlMs: resolveNum(process.env.APP_DRAFT_TTL_MS, DEFAULT_DRAFT_TTL_MS),
  corsOrigin: process.env.APP_CORS_ORIGIN?.trim() || "*",
  logLevel: resolveLogLevel(process.env.APP_LOG_LEVEL, isProduction ? "info" : "debug"),
};

for (const dir of new Set([env.workspaceDir, env.piDir, env.appDir, env.sessionsRoot])) {
  mkdirSync(dir, { recursive: true });
}
