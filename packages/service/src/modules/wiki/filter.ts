/**
 * Wiki 生成的**读取过滤**（F-2.6）。
 *
 * 生成前必须先把"不该读的东西"挡掉，理由各不相同：
 * - `.git` / 依赖 / 构建产物：读了没用，还把预算烧光；
 * - 敏感文件名（`.env`、私钥、凭据）：读进模型上下文等于泄密；
 * - 二进制与超大文件：模型看不懂，还挤掉正文；
 * - 符号链接：可能指到工作区之外，读它等于绕过了"不读出工作区"这条约束。
 *
 * 抽成纯函数是为了可单测：过滤规则最容易漏（漏一个 `.env` 就是安全事故），
 * 而"漏了没有"只能靠逐条断言来保证。
 */

/** 目录名（任意层级）直接整棵跳过。 */
export const SKIP_DIRS: readonly string[] = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "tmp",
  "temp",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".idea",
  ".vscode",
  ".gradle",
  ".terraform",
];

/** 敏感文件名/后缀：命中即排除（宁可少读，不可泄密）。 */
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/iu,
  /\.env$/iu,
  /^\.?netrc$/iu,
  /^\.npmrc$/iu,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/iu,
  /\.(pem|key|p12|pfx|jks|keystore|asc|gpg)$/iu,
  /(credential|secret|password|passwd|private[-_]?key)/iu,
  /^\.aws$/iu,
  /^\.ssh$/iu,
  /^\.git-credentials$/iu,
];

/** 二进制/资源类后缀：读进上下文没有价值。 */
export const BINARY_EXTS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".svgz",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".class",
  ".jar",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wav",
  ".ogg",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".lock",
  ".map",
  ".min.js",
  ".min.css",
];

export const DEFAULT_MAX_FILE_BYTES = 120_000;

export type FilterReason =
  | "skip-dir"
  | "sensitive"
  | "binary"
  | "too-large"
  | "symlink"
  | "not-a-file";

export type FilterVerdict = { include: true } | { include: false; reason: FilterReason };

export type FilterInput = {
  /** 相对工作区根的路径。 */
  path: string;
  kind: "file" | "dir";
  size?: number;
  isSymlink?: boolean;
};

export function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.includes(name.toLowerCase());
}

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isBinaryPath(path: string): boolean {
  const lower = path.toLowerCase();
  return BINARY_EXTS.some((ext) => lower.endsWith(ext));
}

/** 路径上任意一段目录属于跳过目录，整条路径就不读。 */
export function hasSkippedSegment(path: string): boolean {
  return path.split("/").some((segment) => segment !== "" && isSkippedDir(segment));
}

export function filterEntry(
  input: FilterInput,
  limits: { maxFileBytes?: number } = {},
): FilterVerdict {
  if (hasSkippedSegment(input.path)) return { include: false, reason: "skip-dir" };
  const name = input.path.split("/").pop() ?? input.path;
  if (isSensitiveName(name)) return { include: false, reason: "sensitive" };
  if (input.kind === "dir") return { include: false, reason: "not-a-file" };
  if (input.isSymlink === true) return { include: false, reason: "symlink" };
  if (isBinaryPath(input.path)) return { include: false, reason: "binary" };
  const maxBytes = limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (input.size !== undefined && input.size > maxBytes)
    return { include: false, reason: "too-large" };
  return { include: true };
}

const REASON_LABEL: Record<FilterReason, string> = {
  "skip-dir": "目录被跳过（依赖/构建产物/.git）",
  sensitive: "敏感文件",
  binary: "二进制或资源文件",
  "too-large": "文件过大",
  symlink: "符号链接",
  "not-a-file": "目录",
};

export function reasonLabel(reason: FilterReason): string {
  return REASON_LABEL[reason];
}

/** 把排除情况压成一句可读摘要（透明度：用户要能看到"为什么少了这些文件"）。 */
export function summarizeExclusions(
  excluded: readonly { path: string; reason: FilterReason }[],
): string {
  if (excluded.length === 0) return "没有文件被排除。";
  const counts = new Map<FilterReason, number>();
  for (const item of excluded) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reasonLabel(reason)} ×${count}`);
  return `排除了 ${excluded.length} 个文件：${parts.join("；")}。`;
}
