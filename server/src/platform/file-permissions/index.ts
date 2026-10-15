/**
 * 本地凭证文件的权限收紧：只留属主读写。
 *
 * `$APP_HOME/app/` 下几个文件是明文的信任根——`service.json` 有 `serviceToken` 与超管密码、
 * `config.json` 有 provider 的 apiKey——「只有属主读得到」这条前提必须两个平台都成立。
 * POSIX 上 `chmod 0600` 就够；Windows 上 `chmod` 只影响只读位，访问控制由 ACL 决定（默认从父目录
 * 继承），所以要走 `icacls` 去掉继承、只授权当前用户。
 *
 * 收紧失败不抛：它发生在服务已经能跑起来之后，因权限命令失败而拒绝启动比「权限没缩到位」更糟。
 * 但绝不静默——写明文凭证的文件权限没收紧是安全事件。
 */
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";

/** 仅属主可读写 */
export const OWNER_ONLY_MODE = 0o600;

/** 仅属主可进入 / 读写：目录用（浏览器 profile 里是 cookie 与 localStorage） */
export const OWNER_ONLY_DIR_MODE = 0o700;

/** Windows 上给属主的 ACL 权限项：完全控制 */
const ACL_OWNER_GRANT = "F";

/**
 * 告警不走 `platform/logger`：logger 是最早读 `env` 的模块，而 `env` 依赖 `service-registration`，
 * 这里再依赖 logger 就成环（`env → service-registration → file-permissions → logger → env`）。
 * `emitWarning` 同样落在 stderr，一样不静默。
 */
const warn = (message: string): void => {
  process.emitWarning(message, { code: "FILE_PERMISSION" });
};

/**
 * 去掉继承的 ACE，只给当前用户授权。
 *
 * 用 `/grant:r`（替换该用户的显式授权）而不是 `/grant`（追加）：后者每写一次文件就多留一条 ACE。
 */
const hardenOnWindows = (path: string): void => {
  const owner = process.env.USERNAME;
  if (!owner) {
    warn(`无法收紧 ${path} 的权限：环境里没有 USERNAME，确定不了属主`);
    return;
  }
  const result = spawnSync(
    "icacls",
    [path, "/inheritance:r", "/grant:r", `${owner}:${ACL_OWNER_GRANT}`],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    const reason =
      result.stderr?.trim() || result.error?.message || `icacls 退出码 ${result.status ?? "未知"}`;
    warn(`收紧 ${path} 的权限失败（${reason}）：该文件含明文凭证，请手工确认只有当前用户可读`);
  }
};

/** 把路径权限收紧到给定模式；两个平台各自实现，失败只告警 */
const harden = (path: string, mode: number): void => {
  if (process.platform === "win32") {
    hardenOnWindows(path);
    return;
  }
  try {
    chmodSync(path, mode);
  } catch (error) {
    warn(`收紧 ${path} 的权限失败：${error instanceof Error ? error.message : String(error)}`);
  }
};

/** 把文件权限收紧到「仅属主可读写」 */
export const hardenOwnerOnly = (path: string): void => harden(path, OWNER_ONLY_MODE);

/** 把目录权限收紧到「仅属主可进入 / 读写」 */
export const hardenOwnerOnlyDir = (path: string): void => harden(path, OWNER_ONLY_DIR_MODE);
