/**
 * 配置来源的定位与主目录解析：环境文件的查找 / 加载、`$APP_HOME` 的取值。
 *
 * 单独成模块是因为 CLI 的 `service` 子命令只认 `$APP_HOME/app/service.json`，不该被端口、日志级别
 * 这类与它无关的缺失拦住退出；`env.ts` 在这份基础之上继续校验其余配置。
 *
 * 加载顺序（靠后的不覆盖靠前的）：显式环境变量 > 从 cwd 向上找到的环境文件 > 随包默认配置。
 * 随包默认只在安装包形态下生效：源码树里漏写环境文件时静默落到默认主目录（本机往往就是生产目录）
 * 比直接报错危险得多，所以那边保持「缺失即失败」（见 `platform/resources` 的 `isSourceTree`）。
 * 相对路径的解析基准是环境文件所在目录：`APP_HOME` 常写成相对路径（开发模板里的 `.tmp/<品牌>`），
 * 只有相对它解析，在仓库内运行才能落到预期目录。
 *
 * 取值为懒加载：加载哪份环境文件取决于 `NODE_ENV`，而 CLI 要解析完参数才定下它（进而在任何 env
 * 导入之前）——模块加载时就算会拿到旧值，所以第一次访问时才算。
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { APP_DIRNAME, SERVICE_FILENAME } from "../../constants/dirs";
import { expandHome } from "../paths";
import { isSourceTree, resourceRoot } from "../resources";

/** 随包默认配置（dotenv 格式，扩展名避开 .env）：安装包形态下的最后一档来源，源码树里不加载 */
const PACKAGED_DEFAULT_ENV_PATH = resolve(resourceRoot, "defaults/default.conf");

/** 当前形态应加载的环境文件名：生产 `.env.prod`，其余 `.env` */
const envFileName = (): string => (process.env.NODE_ENV === "production" ? ".env.prod" : ".env");

/**
 * 启动期配置缺失 / 非法：logger 依赖 env 尚不可用，故直接写 stderr 并退出。
 * 显式失败优于带默认值静默跑起来——生产与开发的差异都应由环境变量声明。
 */
export const dieConfig = (message: string): never => {
  console.error(`[配置错误] ${message}`);
  console.error(
    `请在环境变量或 ${envFileName()} 里声明（源码树模板见 .env.example 与 .env.prod.example；` +
      "安装包自带默认配置 defaults/default.conf）。",
  );
  process.exit(1);
};

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

export type EnvFilePlanInput = {
  /** 查找起点（进程 cwd） */
  cwd: string;
  /** 按 NODE_ENV 选定的环境文件名 */
  envFile: string;
  /** 是否源码树：那边不加载随包默认配置 */
  sourceTree: boolean;
  /** 随包默认配置文件 */
  defaultsPath: string;
};

export type EnvFilePlan = {
  /** 从 cwd 向上找到的环境文件；它所在目录是相对路径的解析基准 */
  envFile: string | null;
  /** 待加载的文件，靠前的优先（`loadEnvFile` 不覆盖已有键，故后者只补前者没给的那些） */
  files: string[];
};

/** 排出待加载的环境文件：找到的那份在前，随包默认在后 */
export const planEnvFiles = (input: EnvFilePlanInput): EnvFilePlan => {
  const found = findEnvFile(input.cwd, input.envFile);
  const files = found ? [found] : [];
  if (!input.sourceTree && existsSync(input.defaultsPath)) files.push(input.defaultsPath);
  return { envFile: found ?? null, files };
};

/** 环境文件存在但不可读时按未设置处理：缺失项由后续校验兜底 */
const loadQuietly = (path: string): void => {
  try {
    process.loadEnvFile(path);
  } catch {
    // 交给调用方的校验报错
  }
};

/** `APP_HOME` 支持 `~` 与相对路径（相对环境文件所在目录） */
const resolveAppHomeQuietly = (baseDir: string): string | null => {
  const raw = process.env.APP_HOME?.trim();
  if (!raw) return null;
  const expanded = expandHome(raw);
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
};

export type AppHome = {
  /** 工作与配置主目录 */
  homeDir: string;
  /** 应用自有数据目录：config.json / SQLite / service.json */
  appDir: string;
  /** 服务注册文件：host / port / pid / serviceToken / password（0600，服务独占写、客户端只读） */
  servicePath: string;
  /** 该变量是否在加载环境文件之前就已显式设置（区分「显式」与「环境文件里的默认」） */
  wasPreset: (name: string) => boolean;
};

let cached: AppHome | undefined;

export type ConfigSources = {
  /** 当前形态应加载的环境文件名（`.env.prod` / `.env`） */
  envFile: string;
  /** 从 cwd 向上找到的环境文件；没找到为 null */
  foundEnvFile: string | null;
  /** 待加载的文件，靠前的优先 */
  files: string[];
  /** 随包默认配置文件 */
  defaultsPath: string;
  /** 是否跑在源码树里 */
  sourceTree: boolean;
  /** 声明着的 `APP_HOME` 原值（可能带 `~` 或为相对路径）；查看时取，故反映调用当下的状态 */
  appHomeRaw: string | null;
  /** 相对路径的解析基准：找到的环境文件所在目录，否则 cwd */
  baseDir: string;
};

/**
 * 只查询「配置从哪来」，不加载也不退出：CLI 的自检要把「缺什么」全部汇报出来，
 * 而 `loadAppHome` 撞上第一处缺失就结束了进程。
 */
export const inspectConfigSources = (cwd = process.cwd()): ConfigSources => {
  const envFile = envFileName();
  const plan = planEnvFiles({
    cwd,
    envFile,
    sourceTree: isSourceTree,
    defaultsPath: PACKAGED_DEFAULT_ENV_PATH,
  });
  return {
    envFile,
    foundEnvFile: plan.envFile,
    files: plan.files,
    defaultsPath: PACKAGED_DEFAULT_ENV_PATH,
    sourceTree: isSourceTree,
    appHomeRaw: process.env.APP_HOME?.trim() || null,
    baseDir: plan.envFile ? dirname(plan.envFile) : cwd,
  };
};

export type AppHomeProbe =
  | { ok: true; home: AppHome }
  /** 缺 `APP_HOME`：调用方决定是报错退出（`loadAppHome`）还是当作自检的一条失败项 */
  | { ok: false; reason: string };

/**
 * 解析并缓存主目录，缺失时不退出：第一次调用时定下加载哪份环境文件。
 * 显式环境变量的快照必须在加载之前取——加载之后就分不出「用户给的」与「文件里默认的」了。
 */
export const probeAppHome = (cwd = process.cwd()): AppHomeProbe => {
  if (cached) return { ok: true, home: cached };

  const presetKeys = new Set(Object.keys(process.env));
  const sources = inspectConfigSources(cwd);
  for (const file of sources.files) loadQuietly(file);

  const homeDir = resolveAppHomeQuietly(sources.baseDir);
  if (!homeDir) {
    const loaded = sources.files.length > 0 ? sources.files.join("、") : "无环境文件";
    return { ok: false, reason: `缺少环境变量 APP_HOME（已加载：${loaded}）` };
  }

  const appDir = resolve(homeDir, APP_DIRNAME);
  cached = {
    homeDir,
    appDir,
    servicePath: resolve(appDir, SERVICE_FILENAME),
    wasPreset: (name) => presetKeys.has(name),
  };
  return { ok: true, home: cached };
};

/** 解析并缓存主目录相关配置；缺失即按配置错误退出 */
export const loadAppHome = (): AppHome => {
  const probe = probeAppHome();
  return probe.ok ? probe.home : dieConfig("缺少环境变量 APP_HOME");
};
