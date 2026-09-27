/**
 * 会话标识与文件命名（纯函数）。
 *
 * 编码约定与 pi 完全一致——这是"数据根里的 pi 目录是标准 agent-dir"的具体落点：
 * 用真正的 pi CLI 指向同一份目录，两边看到的与会话是同名的同一批文件。
 */
import { join } from "node:path";

/**
 * 把项目路径编码为会话桶目录名。
 * 与 pi 的 `getDefaultSessionDirPath` 一致：去掉前导斜杠，再把 `/` `\` `:` 换成 `-`。
 */
export function encodeProjectDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** 会话桶目录（sessions/--<escaped>--）。 */
export function sessionBucketPath(sessionsRoot: string, cwd: string): string {
  return join(sessionsRoot, encodeProjectDirName(cwd));
}

/**
 * 会话文件名：`<timestamp>_<session-id>.jsonl`。
 * 时间戳用 pi 的写法（ISO 里 `:` 与 `.` 换成 `-`），保证按字典序即时间序。
 */
export function sessionFileName(createdAt: Date, sessionId: string): string {
  return `${createdAt.toISOString().replace(/[:.]/g, "-")}_${sessionId}.jsonl`;
}

/**
 * 会话标识：`<毫秒时间戳 base36>-<随机后缀>`，只含 `[0-9a-z-]` 且单调可排序。
 * 不共享计数器，天然无需跨进程协调。
 */
export function createSessionId(
  now: Date = new Date(),
  random: () => number = Math.random,
): string {
  const time = now.getTime().toString(36);
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `${time}-${suffix}`;
}

/** 会话标识的合法字符集（路径安全校验的第一个关口）。 */
export const SESSION_ID_PATTERN = /^[0-9a-z][0-9a-z-]{2,63}$/;

export function isSafeSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

/** 文件名字段里不允许出现的东西：路径分隔符、上级引用、空字节。 */
export function isSafePathSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= 255 &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0") &&
    segment !== "." &&
    segment !== ".."
  );
}
