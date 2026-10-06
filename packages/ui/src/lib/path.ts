/** 路径展示与拼接相关的纯函数 */

/** 常见家目录前缀：macOS / Linux / root；只做展示缩写，认不出时原样返回 */
const HOME_PREFIX = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/;

/** 把绝对路径的家目录前缀缩写成 `~` */
export const abbreviateHome = (path: string): string => path.replace(HOME_PREFIX, "~");

/** 目录名：取路径最后一段；根目录回落 `/` */
export const baseName = (path: string): string => {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index >= 0 ? trimmed.slice(index + 1) || "/" : trimmed;
};

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
 * 相对路径：`path` 落在 `root` 之下时去掉该前缀（与 `root` 同级时给 `.`），否则原样返回。
 * 与服务端展开 `@` 引用时算块上 `path` 属性的口径一致，正文里的引用标记据此保持同一写法。
 */
export const toRelativePath = (root: string, path: string): string => {
  const base = root.replace(/\/+$/, "");
  if (base === path) return ".";
  // `base` 为空串（root 是 `/`）时只认绝对路径的前导斜杠
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
};
