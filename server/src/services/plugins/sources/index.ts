/**
 * 插件来源的拉取与暂存：把五种来源统一收敛成「一个可装载的目录」。
 *
 * 复制型来源（url / npm / git / github）先落到暂存目录，由调用方读完清单拿到版本号后再搬进
 * `cache/<market>/<plugin>/<version>`；`directory` 来源**不复制**，直接引用用户自己的目录。
 * 出网与进程调用都可注入，便于单测（真实实现是 `publicFetch` 与 `execa`）。
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { execa } from "execa";

import { PLUGIN_BIN_DIRNAME } from "../../../constants/dirs";
import {
  PLUGIN_FETCH_TIMEOUT_MS,
  PLUGIN_GIT_TIMEOUT_MS,
  PLUGIN_PACKAGE_MAX_BYTES,
} from "../../../constants/plugins";
import { findManifestFile } from "../../../harness/plugins/manifest";
import { hashDirectory } from "../../../harness/plugins/source-hash";
import type { PluginSourceSpec } from "../../../harness/plugins/state";
import { logger } from "../../../platform/logger";
import { type PublicFetchResult, publicFetch } from "../../../platform/net";
import { isInsidePath, resolveExistingPath } from "../../../platform/paths";
import { detectArchiveFormat, unpackArchive } from "./unpack";

/** 来源不可用：网络失败、非 2xx、包结构不对、进程调用失败，都归这一类 */
export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export type StagedSource = {
  /** 插件包根目录：可以直接交给清单解析（可能是暂存目录里下钻一层后的那个子目录） */
  path: string;
  /** 是否为复制型的暂存目录（调用方要么把它搬走，要么清理掉） */
  staged: boolean;
  /**
   * 本次占用的**暂存目录顶层**（`mkdtemp` 出来的那个）。
   * 与 `path` 不同时就说明 `path` 是它下面的子目录；清理要清这一层，别删整个 `.staging` 根。
   */
  stagingDir?: string;
  /** 内容摘要：url 记响应哈希、directory 记目录内容哈希、git 记克隆出的 commit */
  integrity?: string;
  /** url 来源的条件请求凭据：检查更新时用它发 304 探测 */
  etag?: string;
  lastModified?: string;
};

/** 进程调用：默认 execa；测试可替换 */
export type SourceRunner = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string }>;

export const defaultSourceRunner: SourceRunner = async (file, args, options) => {
  const startedAt = Date.now();
  try {
    const result = await execa(file, args, { timeout: options.timeout, reject: true });
    // 拉包可能几十秒：留一条可排查的记录（命令、耗时、输出尾巴），不进用户界面
    logger.debug(
      {
        command: `${file} ${args[0] ?? ""}`,
        ms: Date.now() - startedAt,
        tail: typeof result.stderr === "string" ? result.stderr.trim().slice(-400) : "",
      },
      "插件来源命令完成",
    );
    return { stdout: typeof result.stdout === "string" ? result.stdout : "" };
  } catch (error) {
    logger.warn(
      { command: `${file} ${args[0] ?? ""}`, ms: Date.now() - startedAt, args },
      "插件来源命令失败",
    );
    throw error;
  }
};

export type StagePluginSourceInput = {
  source: PluginSourceSpec;
  /** 暂存根目录：复制型来源在它下面建临时目录 */
  stagingRoot: string;
  fetch?: (input: Parameters<typeof publicFetch>[0]) => Promise<PublicFetchResult>;
  run?: SourceRunner;
  /** 阶段提示：拉包 / 解包可能几十秒，调用方把它转成进度帧给界面 */
  onProgress?: (message: string) => void;
};

const makeStagingDir = (stagingRoot: string, prefix: string): string => {
  mkdirSync(stagingRoot, { recursive: true });
  return mkdtempSync(join(stagingRoot, `${prefix}-`));
};

/**
 * 归档 / 仓库常把插件放在一层子目录里（`pkg/plugin.json`、`repo/plugins/foo/`）。
 * 根目录没有插件特征时就往下走一层——只走一层，避免把任意深层结构当插件根。
 */
const descendToPackageRoot = (dir: string): string => {
  const hasPackageMarker = (path: string): boolean =>
    findManifestFile(path) !== null ||
    ["skills", "commands", "agents", "hooks", "bin", "extensions", ".mcp.json"].some((name) =>
      existsSync(join(path, name)),
    );

  if (hasPackageMarker(dir)) return dir;
  const entries = listDirNames(dir);
  const only = entries.length === 1 ? entries[0] : undefined;
  if (!only) return dir;
  const child = join(dir, only);
  try {
    return statSync(child).isDirectory() && hasPackageMarker(child) ? child : dir;
  } catch {
    return dir;
  }
};

/** 目录下的条目名；读不出来就当空目录（调用方会按「找不到插件根」继续处理） */
const listDirNames = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/** `bin/` 下脚本的权限：属主可写、其余可读可执行 */
const BIN_FILE_MODE = 0o755;

/**
 * 给插件 `bin/` 下的文件补可执行位。
 *
 * zip 不携带 unix 权限位，解出来的脚本一律是默认 mode——`bin/` 组件于是形同虚设：目录被追加进
 * PATH，里面的文件却没有执行权限，于是「插件带的命令跑不了」。tgz 与 git 来源自带 mode，不受影响；
 * Windows 不认权限位，由 `PATHEXT` 决定，跳过。
 */
const grantBinExecutables = (root: string): void => {
  if (process.platform === "win32") return;
  const binDir = join(root, PLUGIN_BIN_DIRNAME);
  if (!existsSync(binDir)) return;
  for (const entry of readdirSync(binDir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) chmodSync(join(entry.parentPath, entry.name), BIN_FILE_MODE);
  }
};

/** url 来源：取压缩体 → 解包到暂存目录 */
const stageFromUrl = async (
  source: Extract<PluginSourceSpec, { source: "url" }>,
  input: StagePluginSourceInput,
): Promise<StagedSource> => {
  input.onProgress?.("下载插件包…");
  const fetchImpl = input.fetch ?? publicFetch;
  const response = await fetchImpl({
    url: source.url,
    maxBytes: PLUGIN_PACKAGE_MAX_BYTES,
    timeoutMs: PLUGIN_FETCH_TIMEOUT_MS,
    ...(source.headers ? { headers: source.headers } : {}),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new SourceError(`下载插件包失败：HTTP ${response.status} ${response.url.href}`);
  }
  if (response.truncated) {
    throw new SourceError(`插件包超过上限（${PLUGIN_PACKAGE_MAX_BYTES} 字节）`);
  }

  const format = detectArchiveFormat(source.url, response.body);
  if (!format) {
    throw new SourceError("插件包既不是 zip 也不是 tgz，无法解包");
  }

  input.onProgress?.("解包…");
  const dir = makeStagingDir(input.stagingRoot, "url");
  await unpackArchive({ data: response.body, format, targetDir: dir });
  const root = descendToPackageRoot(dir);
  grantBinExecutables(root);
  return {
    path: root,
    staged: true,
    stagingDir: dir,
    integrity: createHash("sha256").update(response.body).digest("hex"),
    ...(response.etag ? { etag: response.etag } : {}),
    ...(response.lastModified ? { lastModified: response.lastModified } : {}),
  };
};

/** npm 来源：`npm install --prefix <暂存目录>` 后取 node_modules 下的包目录 */
const stageFromNpm = async (
  source: Extract<PluginSourceSpec, { source: "npm" }>,
  input: StagePluginSourceInput,
): Promise<StagedSource> => {
  const run = input.run ?? defaultSourceRunner;
  input.onProgress?.(`npm 安装 ${source.package}…`);
  const dir = makeStagingDir(input.stagingRoot, "npm");
  await run(
    "npm",
    ["install", "--prefix", dir, "--no-save", "--no-audit", "--no-fund", source.package],
    { timeout: PLUGIN_GIT_TIMEOUT_MS },
  );

  // 去掉版本后缀，作用域保留：npm 装出来的路径就是 `node_modules/<name>`（含 `@scope/`）
  const name = source.package.replace(/@[^@/]+$/, "");
  const packageDir = join(dir, "node_modules", ...name.split("/"));
  if (!existsSync(packageDir)) {
    throw new SourceError(`npm 包装完之后找不到：${source.package}`);
  }
  return { path: descendToPackageRoot(packageDir), staged: true, stagingDir: dir };
};

/** git / github 来源：浅克隆到暂存目录，`path` 指定包在仓内的位置 */
const stageFromGit = async (
  source: Extract<PluginSourceSpec, { source: "git" | "github" }>,
  input: StagePluginSourceInput,
): Promise<StagedSource> => {
  const run = input.run ?? defaultSourceRunner;
  const url = source.source === "git" ? source.url : `https://github.com/${source.repo}.git`;
  input.onProgress?.(`克隆 ${url}…`);
  const dir = makeStagingDir(input.stagingRoot, "git");
  const args = ["clone", "--depth", "1"];
  if (source.ref) args.push("--branch", source.ref);
  args.push(url, dir);
  await run("git", args, { timeout: PLUGIN_GIT_TIMEOUT_MS });

  // `path` 由来源方给出（市场条目的 source 也是它），必须落在克隆目录内：否则会把用户任意目录
  // 当插件根搬进缓存（安装是 rename，等于把原目录移走）
  const root = source.path ? resolve(dir, source.path) : dir;
  if (!isInsidePath(dir, root)) {
    throw new SourceError(`仓内路径越出仓库：${source.path ?? ""}`);
  }
  if (!existsSync(root)) throw new SourceError(`仓内路径不存在：${source.path ?? ""}`);

  // 记下克隆到的 commit：检查更新时用 `git ls-remote` 的同一个值比对
  let revision: string | undefined;
  try {
    const result = await run("git", ["-C", dir, "rev-parse", "HEAD"], {
      timeout: PLUGIN_GIT_TIMEOUT_MS,
    });
    revision = result.stdout.trim() || undefined;
  } catch {
    // 拿不到 revision 就不记：只是这次没法做「有没有新版」的判定
  }
  return {
    path: root,
    staged: true,
    stagingDir: dir,
    ...(revision ? { integrity: revision } : {}),
  };
};

/**
 * 把来源收敛成一个可装载的目录。`directory` 不复制（改源码即可重拉），其余来源落暂存目录。
 */
export const stagePluginSource = async (input: StagePluginSourceInput): Promise<StagedSource> => {
  const { source } = input;
  switch (source.source) {
    case "directory": {
      const path = resolveExistingPath(source.path, true);
      const hash = hashDirectory(path)?.hash;
      return { path, staged: false, ...(hash ? { integrity: hash } : {}) };
    }
    case "url":
      return await stageFromUrl(source, input);
    case "npm":
      return await stageFromNpm(source, input);
    case "git":
    case "github":
      return await stageFromGit(source, input);
    default:
      throw new SourceError(`不支持的来源：${basename(JSON.stringify(source))}`);
  }
};
