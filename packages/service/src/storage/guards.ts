import { stat, statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { StorageError } from "./errors.ts";
import { isSafeSessionId, sessionBucketPath } from "./naming.ts";

/**
 * 启动期守卫（spec §3.4 的第 1、5、6、7 条）。
 *
 * 共同点：**拒绝启动，不静默修正**。权限不对就报错、危险文件系统就报错、
 * 版本过高就报错、路径要逃逸就报错——都不做"尽力而为"的处置。
 */

/** 已知云同步目录（路径启发式）。 */
const CLOUD_SYNC_HINTS = [
  "Library/Mobile Documents", // iCloud Drive
  "Dropbox",
  "OneDrive",
  "Google Drive",
  "GoogleDrive",
  "Box Sync",
  "pCloud",
  "MEGAsync",
  "Yandex.Disk",
];

/**
 * 网络文件系统类型（statfs 的 f_type）。
 * 数值来自各内核的头文件常量，跨平台一致（macOS 上 f_type 也返回这些魔数）。
 */
const NETWORK_FS_TYPES: Record<number, string> = {
  26985: "nfs",
  4283649346: "cifs",
  20859: "smb",
  4266872130: "smb2",
  44543: "afp",
  1397113167: "afs",
  16914839: "9p",
  1702057286: "fuse", // 含 sshfs 等远端挂载
  1937076805: "coda",
};

export type DangerousFileSystemCheck = { dangerous: boolean; reason?: string };

/** 默认探测：先看路径是否落在已知云同步目录下，再看 statfs 的文件系统类型。 */
export async function detectDangerousFileSystem(
  dataDir: string,
): Promise<DangerousFileSystemCheck> {
  const resolved = resolve(dataDir);
  const home = homedir();

  for (const hint of CLOUD_SYNC_HINTS) {
    if (resolved.includes(hint)) {
      return { dangerous: true, reason: `位于云同步目录（${hint}）下` };
    }
  }
  if (resolved.startsWith(`${home}/Library/CloudStorage/`)) {
    return { dangerous: true, reason: "位于 macOS 的 CloudStorage 挂载下" };
  }

  try {
    const info = await statfs(resolved);
    const name = NETWORK_FS_TYPES[info.type];
    if (name !== undefined) {
      return { dangerous: true, reason: `文件系统类型是 ${name}（远端挂载）` };
    }
  } catch {
    // statfs 不可用时不做判断（不因为探测失败而拒绝启动）
  }

  return { dangerous: false };
}

/** 归属与权限（spec §3.4 第 1 条）：数据层只对本人可读写。 */
export async function assertPermissions(dataDir: string): Promise<void> {
  if (process.platform === "win32") return; // Windows 的权限模型不同，不做 POSIX 位判断
  const info = await stat(dataDir);
  const mode = info.mode & 0o777;
  if ((info.mode & 0o077) !== 0) {
    throw new StorageError(
      "permission_denied",
      `数据层目录 ${dataDir} 对同组或其他用户可访问（mode=${mode.toString(8)}），拒绝启动。请执行 chmod 700。`,
    );
  }
}

export function assertSafeSessionId(id: string): void {
  if (!isSafeSessionId(id)) {
    throw new StorageError("path_escape", `会话标识不合法：${JSON.stringify(id)}`, { id });
  }
}

/** 由标识派生的路径必须落在数据层目录内（spec §3.4 第 7 条）。 */
export function resolveWithin(base: string, ...segments: string[]): string {
  const resolved = resolve(base, ...segments);
  const normalizedBase = resolve(base);
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + sep)) {
    throw new StorageError("path_escape", `路径逃逸：${resolved} 不在 ${normalizedBase} 内`, {
      base: normalizedBase,
      resolved,
    });
  }
  return resolved;
}

/** 会话桶目录也要走一遍逃逸检查（项目路径来自用户输入）。 */
export function sessionBucketWithin(sessionsRoot: string, cwd: string): string {
  const bucket = sessionBucketPath(sessionsRoot, cwd);
  return resolveWithin(sessionsRoot, bucket.slice(sessionsRoot.length + 1));
}
