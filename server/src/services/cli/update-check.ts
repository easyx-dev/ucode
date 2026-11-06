/**
 * 升级检查：只查 npm 上的最新版本并给安装命令，不动本机安装。
 *
 * 全局安装的权限、镜像与 `--allow-scripts` 之类差异属于用户的包管理器，替人执行 install
 * 会把一次只读查询变成可能改坏环境的写操作——所以这里只报告，不改环境。
 */
import { brand } from "@ucode/brand/values";

import { packageName, serviceVersion } from "../../platform/version";

const REGISTRY_TIMEOUT_MS = 8000;

export type UpdateCheck = {
  /** 本机（与已装包）的版本 */
  current: string;
  /** npm 上的最新版本；查询失败为 null */
  latest: string | null;
  hasUpdate: boolean;
  /** 查询失败的原因 */
  error?: string;
};

type ParsedVersion = { numbers: number[]; prerelease: string | null };

/** 只认 `主.次.补丁[-预发布]`；带 `v` 前缀也算（registry 回来的值不带，容错用） */
const parseVersion = (raw: string): ParsedVersion | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim());
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
};

/**
 * 比较两个版本：`a > b` 回 1，相等 0，`a < b` 回 -1。
 * 同版本号的预发布低于正式版（semver §11 的简化：预发布之间按字符串比，够用于「有没有新版」）。
 */
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return a === b ? 0 : a.localeCompare(b);

  for (const index of [0, 1, 2]) {
    const difference = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return Math.sign(left.prerelease.localeCompare(right.prerelease));
};

/** 安装命令：Linux 上工作台终端用的 node-pty 要现场编译，npm 11 默认不给依赖跑安装脚本 */
const installCommand = (name: string): string =>
  process.platform === "linux"
    ? `npm install -g ${name} --allow-scripts=node-pty`
    : `npm install -g ${name}`;

export const checkForUpdate = async (): Promise<UpdateCheck> => {
  const current = serviceVersion;
  if (!packageName) {
    return { current, latest: null, hasUpdate: false, error: "读不到包名（package.json 的 name）" };
  }

  const url = `https://registry.npmjs.org/${packageName}/latest`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { current, latest: null, hasUpdate: false, error: `registry 返回 ${response.status}` };
    }
    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload.version !== "string") {
      return { current, latest: null, hasUpdate: false, error: "registry 响应里没有 version" };
    }
    return {
      current,
      latest: payload.version,
      hasUpdate: compareVersions(payload.version, current) > 0,
    };
  } catch (error) {
    return {
      current,
      latest: null,
      hasUpdate: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const renderUpdate = (check: UpdateCheck): string => {
  const name = packageName ?? "本包";
  if (check.error) {
    return [`检查最新版本失败：${check.error}`, `可手工查：npm view ${name} version`].join("\n");
  }
  if (!check.hasUpdate) return `已是最新（${check.current}）`;
  return [
    `有新版本：${check.current} → ${check.latest}`,
    `安装：${installCommand(name)}`,
    `装完执行 ${brand.slug} restart，让运行中的实例切换到新版本`,
  ].join("\n");
};

export const renderUpdateJson = (check: UpdateCheck): string =>
  JSON.stringify({ package: packageName, ...check }, null, 2);
