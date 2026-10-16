/** 路径的展示与比较：方言里的引用标记与服务端展开块的 `path` 属性共用这一份换算 */
/** 目录名：取路径最后一段；尾部斜杠不影响结果，根目录回落 `/` */
export const baseName = (path: string): string => {
  const trimmed = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index >= 0 ? trimmed.slice(index + 1) || "/" : trimmed;
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
