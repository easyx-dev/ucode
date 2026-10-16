/** 路径展示与拼接相关的纯函数 */

/** 常见家目录前缀：macOS / Linux / root；只做展示缩写，认不出时原样返回 */
const HOME_PREFIX = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/;

/** 把绝对路径的家目录前缀缩写成 `~` */
export const abbreviateHome = (path: string): string => path.replace(HOME_PREFIX, "~");

/**
 * 长路径的尾部保留缩写：`/a/b/c/d.ts` 在宽度不够时写成 `…/c/d.ts`。
 *
 * 保留尾部而不是首部：同一份文件在界面里认的是文件名与它所在的那几层目录（`ui/src/business`），
 * 前缀（家目录、仓库根）最没信息量，前缀先丢。装得下就原样返回。
 */
export const shortenPath = (path: string, maxChars: number): string => {
  if (path.length <= maxChars) return path;

  // 只切段时归一两种分隔符：装得下仍原样返回，Windows 的 `C:\a\b` 也按段收
  const segments = normalizeSeparators(path)
    .split("/")
    .filter((segment) => segment !== "");
  const tail: string[] = [];
  // 逐段从后往前收，直到再添一段就超预算（`…/` 两个字符也算进去）
  for (const segment of [...segments].reverse()) {
    if ([...tail, segment].join("/").length + 2 > maxChars) break;
    tail.unshift(segment);
  }

  // 一段都装不下（末段本身就超长）时硬留尾部，至少让文件名认得出
  if (tail.length === 0 && segments.length > 0) {
    const last = segments[segments.length - 1] ?? "";
    return `…${last.slice(-Math.max(1, maxChars - 1))}`;
  }
  return `…/${tail.join("/")}`;
};

/**
 * 分隔符归一：Windows 的 `\` 与 POSIX 的 `/` 都归一成 `/`，并去掉尾部分隔符。
 *
 * 不按运行平台选分隔符：路径可能来自另一种写法的接口数据，
 * 同一份判定必须在两种写法下给出同一结论，也才好在任何平台上单测。
 */
const normalizeSeparators = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** 是否**严格**位于 `parent` 之下；分隔符无关，三种平台上结论一致 */
export const isUnderPath = (child: string, parent: string): boolean =>
  normalizeSeparators(child).startsWith(`${normalizeSeparators(parent)}/`);

/** 拼接子路径；父路径为根目录时避免出现 `//` */
export const joinPath = (parent: string, name: string): string =>
  parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;

/** 上级目录；`/Users` → `/`，根目录回落 `/` */
export const dirName = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  if (index < 0) return ".";
  return index === 0 ? "/" : trimmed.slice(0, index);
};

/**
 * 相对路径与目录名：`@` 引用标记的换算口径在 `@ucode/markdown` 里（与服务端展开块的 `path` 同一份），
 * 这里转出去给界面用，避免同一规则写两遍。
 */
export { baseName, toRelativePath } from "@ucode/markdown";

/** 是否绝对路径；同时认 POSIX 的 `/` 与 Windows 的盘符 / UNC */
export const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");

/**
 * 把会话工作目录下的相对路径补成绝对路径。
 *
 * 工具入参与 `@` 引用里的路径多半是相对 cwd 的，而服务端解析相对路径用的是**服务进程**的 cwd，
 * 因此必须在这里先拼成绝对路径再发出去。已经是绝对路径、或没有 cwd 可用时原样返回。
 */
export const resolveFromCwd = (cwd: string | null | undefined, path: string): string => {
  const trimmed = path.trim();
  if (!trimmed || isAbsolutePath(trimmed) || !cwd) return trimmed;
  const base = cwd.replace(/\/+$/, "");
  return `${base}/${trimmed.replace(/^\.\//, "")}`;
};
