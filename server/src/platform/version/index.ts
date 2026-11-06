/**
 * 服务端版本与包名：启动时从包清单读一次，供 /health、/info、兼容判定与 CLI 的版本 / 升级检查复用。
 *
 * 包名不写死字面量：品牌校验会拦下 `server/src` 里的品牌串（`@scope/<slug>` 去掉 scope 后正好命中），
 * 而清单里的 `name` 本来就是发布名的事实源，B 端改名时两处不会脱节。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resourceRoot } from "../resources";

type Manifest = {
  version?: unknown;
  name?: unknown;
  engines?: { node?: unknown };
};

/** 读不到或解析不了都按「未知」处理：版本不该拦住 CLI 的 `--help` / `--version` */
const readManifest = (): Manifest => {
  try {
    return JSON.parse(readFileSync(resolve(resourceRoot, "package.json"), "utf8")) as Manifest;
  } catch {
    return {};
  }
};

const manifest = readManifest();

export const serviceVersion = typeof manifest.version === "string" ? manifest.version : "0.0.0";

/** npm 包名：升级检查（`update` 子命令）查 registry 用；读不到清单时为 null（由调用方给出提示） */
export const packageName = typeof manifest.name === "string" ? manifest.name : null;

/** 最低 Node 主版本：取清单的 `engines.node`（`>=24`）；读不到时没有要求 */
export const minNodeMajor = ((): number | null => {
  const raw = manifest.engines?.node;
  const match = typeof raw === "string" ? /(\d+)/.exec(raw) : null;
  return match?.[1] ? Number(match[1]) : null;
})();

/**
 * 兼容客户端版本范围（semver range 字符串）：只出范围，取自身的主次版本。
 * 判定在客户端（`semver.satisfies`），见 plans/service-and-auth.md §4。
 */
export const compatRange = `^${serviceVersion.split(".").slice(0, 2).join(".")}.0`;
