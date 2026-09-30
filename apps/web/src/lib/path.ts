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
