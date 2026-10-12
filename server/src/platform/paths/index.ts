/** 路径归一化与校验：fs / 会话工作区 / 权限规则共用，保证路径与会话 cwd 能精确匹配 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";

import { ERROR_CODES } from "@ucode/contracts";

import { AppError } from "../response";

/**
 * 从 cwd 逐级向上的目录链（近者在前）；遇到 `stopAt` 中的目录、含 `.git` 的项目根
 * 或文件系统根即停（含该目录）。项目级资源与自定义角色目录共用同一口径。
 */
export const ancestorDirs = (cwd: string, stopAt: readonly string[] = []): string[] => {
  const stops = new Set(stopAt.map((dir) => resolve(dir)));
  const dirs: string[] = [];
  let current = resolve(cwd);
  while (true) {
    dirs.push(current);
    if (stops.has(current) || existsSync(resolve(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
};

/** 展开开头的 `~`；只处理 `~` 与 `~/`，`~user` 交给 realpath 报「不存在」 */
export const expandHome = (input: string): string => {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
};

/**
 * 绝对化（含 `~` 展开）并折叠 `.` / `..`，不要求存在；用于将要创建的目标路径。
 *
 * 折叠这一步是会话 cwd、项目键与 fs 目标路径共用同一口径的前提：同一目录的
 * `/a/../b` 与 `/b` 两种写法必须收敛到同一个字符串，否则会被当成两处。
 */
export const resolveTargetPath = (input: string): string =>
  resolve(process.cwd(), expandHome(input.trim()));

/**
 * 归一化成绝对真实路径（realpath），让符号链接、`..`、相对路径都收敛到同一串。
 * 路径必须存在；`directoryOnly` 为真时还要求是目录。不存在或类型不符都抛 `path_not_found`。
 */
export const resolveExistingPath = (input: string, directoryOnly = true): string => {
  let real: string;
  try {
    real = realpathSync(resolveTargetPath(input));
  } catch {
    throw new AppError(ERROR_CODES.pathNotFound, `路径不存在：${input}`, 400, undefined, {
      path: input,
    });
  }

  if (directoryOnly && !statSync(real).isDirectory()) {
    throw new AppError(ERROR_CODES.pathNotFound, `不是目录：${input}`, 400, undefined, {
      path: input,
    });
  }
  return real;
};

/** 上级目录；根目录返回 null（目录选择器据此禁用「返回上级」） */
export const parentPathOf = (path: string): string | null => {
  const parent = resolve(path, "..");
  return parent === path ? null : parent;
};

/**
 * `child` 是否就是 `parent` 或落在它内部（纯字符串判定，要求两者都是绝对路径）。
 * 前缀比较必须带上分隔符，否则 `/a/bc` 会被误判成在 `/a/b` 内。
 */
export const isInsidePath = (parent: string, child: string): boolean => {
  const base = resolve(parent);
  const target = resolve(child);
  return target === base || target.startsWith(`${base}${sep}`);
};

/** 平台路径转 posix（`\` → `/`）：权限规则匹配与展示统一用 `/`，屏蔽平台差异 */
export const toPosixPath = (path: string): string => path.split(sep).join("/");
