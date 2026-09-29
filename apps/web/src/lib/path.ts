/** 路径展示相关的纯函数 */

/** 常见家目录前缀：macOS / Linux / root；只做展示缩写，认不出时原样返回 */
const HOME_PREFIX = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/;

/** 把绝对路径的家目录前缀缩写成 `~` */
export const abbreviateHome = (path: string): string => path.replace(HOME_PREFIX, "~");
