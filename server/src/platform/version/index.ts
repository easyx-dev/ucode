/** 服务端版本：启动时从包清单读一次，供 /health、/info、兼容判定与 CLI 的版本输出复用 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resourceRoot } from "../resources";

const readVersion = (): string => {
  try {
    const manifest = JSON.parse(readFileSync(resolve(resourceRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const serviceVersion = readVersion();

/**
 * 兼容客户端版本范围（semver range 字符串）：只出范围，取自身的主次版本。
 * 判定在客户端（`semver.satisfies`），见 plans/service-and-auth.md §4。
 */
export const compatRange = `^${serviceVersion.split(".").slice(0, 2).join(".")}.0`;
