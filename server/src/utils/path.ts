/** 路径归一化与校验：fs / 会话工作区 / 权限规则共用，保证路径与会话 cwd 能精确匹配 */
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

import { ERROR_CODES } from "@ucode/contracts";

import { AppError } from "../lib/response";

/** 展开开头的 `~`；只处理 `~` 与 `~/`，`~user` 交给 realpath 报「不存在」 */
const expandHome = (input: string): string => {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
};

/** 绝对化（含 `~` 展开），不要求存在；用于将要创建的目标路径 */
export const resolveTargetPath = (input: string): string => {
  const expanded = expandHome(input.trim());
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
};

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

/** 平台路径转 posix（`\` → `/`）：权限规则匹配与展示统一用 `/`，屏蔽平台差异 */
export const toPosixPath = (path: string): string => path.split(sep).join("/");
