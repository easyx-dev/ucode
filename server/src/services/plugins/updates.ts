/**
 * 已装插件的「来源是否已变 / 有没有新版」判定：一张表按来源分派。
 *
 * | 来源 | 判据 |
 * | --- | --- |
 * | `directory` | 目录内容哈希与该记录里的 `integrity` 比 |
 * | `url` | 条件请求（`If-None-Match` / `If-Modified-Since`）：304 即未变 |
 * | `npm` | registry 的最新版本与已装版本比 |
 * | `git` / `github` | `git ls-remote` 的 commit 与已装 revision 比 |
 *
 * 只在显式动作（刷新市场）里跑，列表接口不碰网络。判定做不了（离线、命令失败、哈希超限）
 * 返回 null：**不猜结论**，也不刷新 `checkedAt`——那个字段的含义是「上次检查成功的时刻」。
 */
import { createHash } from "node:crypto";
import { PLUGIN_FETCH_TIMEOUT_MS, PLUGIN_PACKAGE_MAX_BYTES } from "../../constants/plugins";
import { hashDirectory } from "../../harness/plugins/source-hash";
import type { InstalledPluginRecord } from "../../harness/plugins/state";
import type { PublicFetchResult, publicFetch } from "../../platform/net";
import { resolveExistingPath } from "../../platform/paths";
import type { SourceRunner } from "./sources";

export type SourceUpdate = {
  /** 来源内容是否已变（该不该重拉） */
  updateAvailable: boolean;
  /** 远端最新版本；判定不出来时缺省 */
  latestVersion?: string;
  /** 该来源的内容摘要：目录内容哈希 / url 响应哈希；不变则沿用旧值 */
  integrity?: string;
};

export type CheckSourceUpdateInput = {
  record: InstalledPluginRecord;
  at: string;
  run: SourceRunner;
  fetch: (input: Parameters<typeof publicFetch>[0]) => Promise<PublicFetchResult>;
};

/** 目录来源：内容哈希比对 */
const checkDirectory = (record: InstalledPluginRecord): SourceUpdate | null => {
  if (record.source.source !== "directory") return null;
  // 登记时存的是用户原样输入的路径（可能带 `~`）：按进程 cwd 直接读会读不到，永远判不出更新
  const hash = hashDirectory(resolveExistingPath(record.source.path) ?? record.source.path)?.hash;
  if (!hash) return null;
  return {
    updateAvailable: record.integrity !== undefined && record.integrity !== hash,
    ...(record.integrity === undefined ? { integrity: hash } : {}),
  };
};

/** url 来源：条件请求探测；304 表示内容未变 */
const checkUrl = async (
  record: InstalledPluginRecord,
  input: CheckSourceUpdateInput,
): Promise<SourceUpdate | null> => {
  if (record.source.source !== "url") return null;
  const headers: Record<string, string> = {};
  if (record.etag) headers["if-none-match"] = record.etag;
  if (record.lastModified) headers["if-modified-since"] = record.lastModified;

  const response = await input.fetch({
    url: record.source.url,
    headers,
    maxBytes: PLUGIN_PACKAGE_MAX_BYTES,
    timeoutMs: PLUGIN_FETCH_TIMEOUT_MS,
  });

  if (response.status === 304) return { updateAvailable: false };
  if (response.status < 200 || response.status >= 300) return null;
  return {
    updateAvailable: true,
    integrity: createHash("sha256").update(response.body).digest("hex"),
  };
};

/** npm 来源：registry 上的最新版本与已装版本比 */
const checkNpm = async (
  record: InstalledPluginRecord,
  input: CheckSourceUpdateInput,
): Promise<SourceUpdate | null> => {
  if (record.source.source !== "npm") return null;
  let stdout: string;
  try {
    const result = await input.run("npm", ["view", record.source.package, "version"], {
      timeout: PLUGIN_FETCH_TIMEOUT_MS,
    });
    stdout = result.stdout;
  } catch {
    return null;
  }
  const latest = stdout.trim().split("\n").pop()?.trim();
  if (!latest) return null;
  return { updateAvailable: latest !== record.version, latestVersion: latest };
};

/** git / github 来源：`git ls-remote` 拿到目标 ref 的 commit，与已装 revision 比 */
const checkGit = async (
  record: InstalledPluginRecord,
  input: CheckSourceUpdateInput,
): Promise<SourceUpdate | null> => {
  const source = record.source;
  if (source.source !== "git" && source.source !== "github") return null;
  const url = source.source === "git" ? source.url : `https://github.com/${source.repo}.git`;

  let stdout: string;
  try {
    // 带 ref 时只查那一个引用；不带就查 HEAD（默认分支）
    const result = await input.run("git", ["ls-remote", url, source.ref ?? "HEAD"], {
      timeout: PLUGIN_FETCH_TIMEOUT_MS,
    });
    stdout = result.stdout;
  } catch {
    return null;
  }
  const revision = stdout.trim().split("\n")[0]?.split("\t")[0]?.trim();
  if (!revision) return null;
  return { updateAvailable: record.integrity !== undefined && record.integrity !== revision };
};

/** 按来源分派；判定不出来返回 null（调用方保持记录原样） */
export const checkSourceUpdate = async (
  input: CheckSourceUpdateInput,
): Promise<SourceUpdate | null> => {
  switch (input.record.source.source) {
    case "directory":
      return checkDirectory(input.record);
    case "url":
      return await checkUrl(input.record, input);
    case "npm":
      return await checkNpm(input.record, input);
    case "git":
    case "github":
      return await checkGit(input.record, input);
    default:
      return null;
  }
};
