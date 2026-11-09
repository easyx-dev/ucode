/**
 * 预览器：按文件类型分派渲染器。
 *
 * 这里是纯逻辑层（不给 React、不碰网络）：扩展名 → 预览类别，供预览宿主选渲染器、
 * 供文件树选图标，也供后续接入 pdf / word 时扩表。类别的**内容形态**（文本 / 二进制）
 * 以服务端 `fs/read` 的判定为准，扩展名只决定「用哪种渲染器去展示」。
 */

/** 预览类别；`text` 是兜底桶（含未知扩展名与二进制内容），由文本渲染器自己再分岔 */
export const PREVIEW_KINDS = ["text", "markdown", "image", "pdf", "document"] as const;

export type PreviewKind = (typeof PREVIEW_KINDS)[number];

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  // SVG 默认也走 `<img>`（图片标签里不执行脚本）；它是文本图片，另给「源码」形态
  "svg",
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

const PDF_EXTENSIONS = new Set(["pdf"]);

/** 需要专门渲染器的办公文档；渲染器尚未接入，先占位提示 */
const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "odt", "rtf", "xls", "xlsx", "ppt", "pptx"]);

/** 路径的扩展名（小写、不含点）；没有扩展名或只有点开头文件名时返回空串 */
export const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // `.gitignore` 这类以点开头的名字不算扩展名
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

export const previewKindOf = (path: string): PreviewKind => {
  const extension = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (PDF_EXTENSIONS.has(extension)) return "pdf";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  return "text";
};

/**
 * 可当文本看的图片：目前只有 SVG（它本质是 XML）。
 * 预览宿主据此给它多一个「源码」形态——与 markdown 的预览 / 源码是同一回事。
 */
export const isTextImage = (path: string): boolean => extensionOf(path) === "svg";

/** 图片预览的 MIME；`fs/read` 只给 base64 字节，data URL 需要它 */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** 按扩展名取图片 MIME；认不出时回落到 `application/octet-stream` */
export const imageMimeOf = (path: string): string =>
  IMAGE_MIME[extensionOf(path)] ?? "application/octet-stream";

/** 人类可读的体积（预览器的占位态用） */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
