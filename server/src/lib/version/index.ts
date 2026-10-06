/** 服务端版本：启动时从包清单读一次，供 /health、/info 与兼容判定复用 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { env } from "../../env";

const readVersion = (): string => {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(env.resourceRoot, "package.json"), "utf8"),
    ) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const serviceVersion = readVersion();

/**
 * 兼容客户端版本范围（semver range 字符串）。
 * 判定只需主次版本（见 plans/service-and-auth.md §4），故范围取服务端自身的主次版本。
 */
export const compatRange = `^${serviceVersion.split(".").slice(0, 2).join(".")}.0`;
