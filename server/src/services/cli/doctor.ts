/**
 * 安装与运行环境自检：把「装完跑不起来」的常见原因一次列全，每项给出结论与修复建议。
 *
 * 只读：不改文件、不起进程、不调用会写数据的接口（版本探测走未认证的 `GET /api/v1/info`）。
 * 因此它可以在生产实例活着时安全运行——排障时最需要的正是这个。
 *
 * 有意**不** import `env.ts`：它在模块顶层建目录且缺项即退出，自检会变成「造目录 + 撞到第一处缺失就结束」。
 * 这里只用 `platform/app-home` 的探测入口自己拼路径。
 */
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { resolve } from "node:path";

import { brand } from "@ucode/brand/values";

import {
  CONFIG_FILENAME,
  DB_FILENAME,
  HARNESS_DIRNAME,
  WORKSPACE_DIRNAME,
} from "../../constants/dirs";
import {
  type AppHome,
  type ConfigSources,
  inspectConfigSources,
  probeAppHome,
} from "../../platform/app-home";
import { OWNER_ONLY_MODE } from "../../platform/file-permissions";
import { readInstanceVersion } from "../../platform/instance";
import { resourceRoot } from "../../platform/resources";
import { readServiceRegistration } from "../../platform/service-registration";
import { minNodeMajor, packageName, serviceVersion } from "../../platform/version";
import { serviceStatus } from "../service-control";

export type DoctorLevel = "ok" | "warn" | "fail" | "info";

export type DoctorCheck = {
  /** 检查项名称 */
  name: string;
  level: DoctorLevel;
  /** 观测到的值或结论 */
  detail: string;
  /** 修复建议：warn / fail 时给出 */
  hint?: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  /** 有 fail 项：CLI 据此给非零退出码 */
  hasFailure: boolean;
};

const LEVEL_LABEL: Record<DoctorLevel, string> = {
  ok: "ok",
  warn: "warn",
  fail: "fail",
  info: "info",
};

/** SQLite 文件头（16 字节，含结尾的 NUL） */
const SQLITE_HEADER = "SQLite format 3\u0000";

/**
 * 终端显示宽度：中文与全角标点占两列。
 * `padEnd` 只按码元算，直接用会把中文名字那一列挤歪。
 */
const FULL_WIDTH =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

export const displayWidth = (text: string): number =>
  [...text].reduce((width, char) => width + (FULL_WIDTH.test(char) ? 2 : 1), 0);

/** 右补空格到指定显示宽度（`padEnd` 按码元补，中文会短一截） */
const padToWidth = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - displayWidth(text)));

const checkNode = (): DoctorCheck => {
  const major = Number(process.versions.node.split(".")[0]);
  if (minNodeMajor === null) {
    return {
      name: "Node 版本",
      level: "info",
      detail: `${process.versions.node}（清单未声明 engines.node）`,
    };
  }
  if (major < minNodeMajor) {
    return {
      name: "Node 版本",
      level: "fail",
      detail: `当前 ${process.versions.node}，要求 ≥ ${minNodeMajor}`,
      hint: "会话数据库用的是 node:sqlite，低于该版本起不来；升级 Node 后重装",
    };
  }
  return { name: "Node 版本", level: "ok", detail: process.versions.node };
};

const checkRuntime = (sources: ConfigSources): DoctorCheck => ({
  name: "运行形态",
  level: "info",
  detail: `${sources.sourceTree ? "源码树" : "npm 安装包"}（${resourceRoot}，${process.platform} ${process.arch}）`,
});

const checkConfigSources = (sources: ConfigSources): DoctorCheck => {
  const name = "配置来源";
  if (sources.foundEnvFile) {
    const extra = sources.files.length > 1 ? `（另有随包默认 ${sources.defaultsPath} 兜底）` : "";
    return { name, level: "ok", detail: `${sources.foundEnvFile}${extra}` };
  }
  if (sources.sourceTree) {
    return {
      name,
      level: "fail",
      detail: `没有找到 ${sources.envFile}`,
      hint: "源码树不加载随包默认配置：从仓库根放一份环境文件（模板 .env.example / .env.prod.example）",
    };
  }
  if (existsSync(sources.defaultsPath)) {
    return {
      name,
      level: "ok",
      detail: `没有 ${sources.envFile}，使用随包默认配置 ${sources.defaultsPath}`,
    };
  }
  return {
    name,
    level: "fail",
    detail: `既没有 ${sources.envFile}，也没有随包默认配置`,
    hint: "重装安装包，或从仓库根放一份环境文件",
  };
};

const checkAppHome = (home: AppHome, sources: ConfigSources): DoctorCheck => {
  const name = "数据目录";
  const origin = home.wasPreset("APP_HOME")
    ? "环境变量"
    : (sources.foundEnvFile ?? sources.defaultsPath);
  const dirs: ReadonlyArray<readonly [string, string]> = [
    ["主目录", home.homeDir],
    ["应用目录", home.appDir],
    ["运行数据", resolve(home.homeDir, HARNESS_DIRNAME)],
    ["会话工作区", resolve(home.homeDir, WORKSPACE_DIRNAME)],
  ];

  const missing: string[] = [];
  const unwritable: string[] = [];
  for (const [label, dir] of dirs) {
    if (!existsSync(dir)) {
      missing.push(`${label} ${dir}`);
      continue;
    }
    try {
      accessSync(dir, constants.W_OK);
    } catch {
      unwritable.push(`${label} ${dir}`);
    }
  }

  if (unwritable.length > 0) {
    return {
      name,
      level: "fail",
      detail: `不可写：${unwritable.join("；")}`,
      hint: "服务要往这里写 config.json / 数据库 / 会话，先修好属主与权限",
    };
  }
  if (missing.length > 0) {
    return {
      name,
      level: "warn",
      detail: `还不存在（首次启动会创建）：${missing.join("；")}`,
    };
  }
  return { name, level: "ok", detail: `${home.homeDir}（APP_HOME 来自${origin}）` };
};

const checkWebBuild = (): DoctorCheck => {
  const name = "Web 界面";
  const indexPath = resolve(resourceRoot, "apps/web/dist/index.html");
  if (existsSync(indexPath)) return { name, level: "ok", detail: indexPath };
  return {
    name,
    level: "fail",
    detail: `缺少 ${indexPath}`,
    hint: "源码树跑 pnpm build；全局安装的包缺它说明安装不完整，重装一遍",
  };
};

/** node-pty 是工作台终端的前提，且 Linux 上 npm 常常不给依赖跑安装脚本 */
const checkNodePty = (): DoctorCheck => {
  const name = "工作台终端";
  try {
    createRequire(import.meta.url)("node-pty");
    return { name, level: "ok", detail: "node-pty 可加载" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const installName = packageName ?? "本包";
    return {
      name,
      level: "warn",
      detail: `node-pty 加载失败：${reason}`,
      hint:
        process.platform === "linux"
          ? `Linux 要现场编译它：npm install -g ${installName} --allow-scripts=node-pty`
          : `重装安装包；仍失败时贴 ${brand.slug} doctor --json 的输出`,
    };
  }
};

const checkRegistration = (home: AppHome): DoctorCheck => {
  const name = "服务注册";
  if (!existsSync(home.servicePath)) {
    return {
      name,
      level: "fail",
      detail: `没有 ${home.servicePath}`,
      hint: `${brand.slug} start 首次启动时生成（含登录密码与 serviceToken）`,
    };
  }
  if (!readServiceRegistration(home.servicePath)) {
    return {
      name,
      level: "fail",
      detail: `${home.servicePath} 内容不完整或已损坏`,
      hint: `删掉它再 ${brand.slug} start 会重新生成凭证（已登录的浏览器需要重新登录）`,
    };
  }
  if (process.platform === "win32") {
    return {
      name,
      level: "ok",
      detail: `${home.servicePath}（Windows 上由 ACL 决定，不核对 mode）`,
    };
  }

  const mode = readFileMode(home.servicePath);
  if (mode === null) {
    return { name, level: "warn", detail: `读不到 ${home.servicePath} 的权限` };
  }
  if (mode === OWNER_ONLY_MODE) {
    return { name, level: "ok", detail: `${home.servicePath}（权限 ${mode.toString(8)}）` };
  }
  return {
    name,
    level: "fail",
    detail: `${home.servicePath} 权限 ${mode.toString(8)}，应为 ${OWNER_ONLY_MODE.toString(8)}`,
    hint: `文件里有明文密码与令牌：chmod ${OWNER_ONLY_MODE.toString(8)} "${home.servicePath}"`,
  };
};

const readFileMode = (path: string): number | null => {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
};

/** 文件字节数；读不到按 0 处理（后续 header 读取会给出具体原因） */
const fileSizeOf = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/** 端口探测的超时：本地连接要么立刻成，要么就不成 */
const PORT_PROBE_TIMEOUT_MS = 500;

/** 通配地址不能直接连：与 `toUrlHost` 同一口径，但 TCP 连接不带 IPv6 方括号 */
const toConnectHost = (host: string): string =>
  host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;

/**
 * 端口上有没有进程在监听：只建一条 TCP 连接、不发任何数据。
 * 用于区分「服务没起」与「端口被别的东西占着」——后者才是启动失败的常见原因。
 */
const isPortAnswering = (host: string, port: number): Promise<boolean> =>
  new Promise((resolvePromise) => {
    const socket = createConnection({ host: toConnectHost(host), port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

const checkInstance = async (home: AppHome): Promise<DoctorCheck> => {
  const name = "实例";
  const status = await serviceStatus(home.servicePath);

  if (!status.running) {
    // 未运行但端口上有本服务答话：多半是另一个 APP_HOME 的实例占着
    const foreign = status.url ? await readInstanceVersion(status.url) : null;
    if (foreign) {
      return {
        name,
        level: "warn",
        detail: `未运行，但 ${status.url} 上有服务答话（不是本实例，版本 ${foreign}）`,
        hint: "端口被别的进程占用：换 APP_PORT，或结束那个进程",
      };
    }

    // 不是本服务也照样可能占着端口（另一个 dev server、残留进程），这才是启动失败最常见的原因
    const occupied =
      status.host !== null && status.port !== null && status.port > 0
        ? await isPortAnswering(status.host, status.port)
        : false;
    if (occupied) {
      return {
        name,
        level: "warn",
        detail: `未运行，但端口 ${status.port} 上有进程在监听`,
        hint: `换 APP_PORT，或结束占用它的进程（lsof -i tcp:${status.port}）`,
      };
    }

    return {
      name,
      level: "info",
      detail: `未运行（${brand.slug} start 启动）`,
    };
  }

  const version = status.url ? await readInstanceVersion(status.url) : null;
  if (version && version !== serviceVersion) {
    return {
      name,
      level: "warn",
      detail: `运行中 ${status.url}（pid ${status.pid}），实例版本 ${version}，本机 CLI ${serviceVersion}`,
      hint: `升级后忘了重启：${brand.slug} restart 让实例跑上新版本`,
    };
  }
  const versionText = version ? `，版本 ${version}` : "";
  return { name, level: "ok", detail: `运行中 ${status.url}（pid ${status.pid}${versionText}）` };
};

const readJsonObject = (path: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const checkModelConfig = (home: AppHome): DoctorCheck => {
  const name = "模型配置";
  const configPath = resolve(home.appDir, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return {
      name,
      level: "warn",
      detail: "还没有 config.json：模型未配置",
      hint: "打开界面 → 设置 → 模型，或 POST /api/v1/config/update",
    };
  }
  const config = readJsonObject(configPath);
  if (!config) {
    return {
      name,
      level: "warn",
      detail: `${configPath} 无法解析`,
      hint: "从界面重新保存一份配置",
    };
  }
  const providers = Array.isArray(config.providers) ? config.providers : [];
  if (providers.length === 0) {
    return {
      name,
      level: "warn",
      detail: "providers 为空：模型未配置",
      hint: "打开界面 → 设置 → 模型填一个供应商",
    };
  }
  const defaultModel = typeof config.defaultModel === "string" ? config.defaultModel : null;
  return {
    name,
    level: "ok",
    detail: `${providers.length} 个供应商${defaultModel ? `，默认模型 ${defaultModel}` : ""}`,
  };
};

const readHeader = (path: string, length: number): string | null => {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(length);
    const filled = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, filled).toString("latin1");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

const checkDatabase = (home: AppHome): DoctorCheck => {
  const name = "数据库";
  const dbPath = resolve(home.appDir, DB_FILENAME);
  if (!existsSync(dbPath)) {
    return { name, level: "warn", detail: `还没有 ${dbPath}（首次启动会创建）` };
  }
  // 0 字节不是损坏：SQLite 把它当新库，首次写入时才落文件头（启动到一半被杀就会留下这种文件）
  const size = fileSizeOf(dbPath);
  if (size === 0) {
    return {
      name,
      level: "warn",
      detail: `${dbPath} 是空文件（0 字节）`,
      hint: "启动服务即可，SQLite 会按新库初始化",
    };
  }
  const header = readHeader(dbPath, SQLITE_HEADER.length);
  if (header === null) {
    return { name, level: "warn", detail: `${dbPath} 读不了（权限或占用）` };
  }
  if (header !== SQLITE_HEADER) {
    return {
      name,
      level: "fail",
      detail: `${dbPath} 不是 SQLite 数据库（${size} 字节）`,
      hint: "多半是被别的东西写坏了：挪走它，服务会按新布局重建（会话 JSONL 不受影响）",
    };
  }
  return { name, level: "ok", detail: dbPath };
};

/** 逐项自检；顺序即展示顺序（先环境，再数据，最后实例） */
export const runDoctor = async (): Promise<DoctorReport> => {
  // 先看配置来源再加载：加载之后 process.env 里就有 APP_HOME 了，分不出它是用户给的还是文件里的
  const sources = inspectConfigSources();
  const checks: DoctorCheck[] = [checkNode(), checkRuntime(sources), checkConfigSources(sources)];

  const probe = probeAppHome();
  if (!probe.ok) {
    checks.push({
      name: "数据目录",
      level: "fail",
      detail: probe.reason,
      hint: `在环境文件或环境变量里声明 APP_HOME（随包默认是 ~/.${brand.slug}）`,
    });
    return { checks, hasFailure: true };
  }

  checks.push(
    checkAppHome(probe.home, sources),
    checkWebBuild(),
    checkNodePty(),
    checkRegistration(probe.home),
    await checkInstance(probe.home),
    checkModelConfig(probe.home),
    checkDatabase(probe.home),
  );
  return { checks, hasFailure: checks.some((check) => check.level === "fail") };
};

export const renderDoctor = (report: DoctorReport): string => {
  const width = report.checks.reduce((max, check) => Math.max(max, displayWidth(check.name)), 0);
  const rows = report.checks.map((check) => {
    const head = `  ${LEVEL_LABEL[check.level].padEnd(4)}  ${padToWidth(check.name, width)}  ${check.detail}`;
    return check.hint ? `${head}\n        → ${check.hint}` : head;
  });
  const failures = report.checks.filter((check) => check.level === "fail").length;
  const warnings = report.checks.filter((check) => check.level === "warn").length;
  const summary = [
    failures > 0 ? `${failures} 项未通过` : "自检通过",
    warnings > 0 ? `${warnings} 项提示` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("，");
  return [`${brand.name} 自检（${serviceVersion}）`, "", ...rows, "", summary].join("\n");
};

export const renderDoctorJson = (report: DoctorReport): string =>
  JSON.stringify(
    {
      version: serviceVersion,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      ok: !report.hasFailure,
      checks: report.checks,
    },
    null,
    2,
  );
