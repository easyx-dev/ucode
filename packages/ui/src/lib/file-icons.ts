/**
 * 文件类型 → 图标：只做映射，不引图标库以外的资源。
 *
 * lucide 没有「某语言」图标，所以按大类给（代码 / 文本 / JSON / 配置 / 图片 / 锁文件…），
 * 由扩展名与少量约定文件名决定；认不出的给通用文件图标，不硬凑。
 */
import {
  Braces,
  FileCode,
  File as FileDefault,
  FileDiff,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileText,
  FileType,
  type LucideIcon,
  ScrollText,
  Settings2,
} from "lucide-react";

import { extensionOf } from "./preview";

const CODE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "swift",
  "rb",
  "php",
  "c",
  "h",
  "cpp",
  "cc",
  "hpp",
  "cs",
  "lua",
  "dart",
  "scala",
  "ex",
  "exs",
  "r",
  "pl",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "sql",
  "vue",
  "svelte",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "proto",
  "graphql",
  "gql",
  "tf",
  "hcl",
  "zig",
];

const DOC_EXTENSIONS = ["md", "markdown", "mdx", "rst", "txt"];
const CONFIG_EXTENSIONS = ["yml", "yaml", "toml", "ini", "conf", "env", "properties"];
const IMAGE_EXTENSIONS = ["svg", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"];
const TABLE_EXTENSIONS = ["csv", "tsv", "xls", "xlsx"];
const DIFF_EXTENSIONS = ["diff", "patch"];
const FONT_EXTENSIONS = ["woff", "woff2", "ttf", "otf"];

const fill = (extensions: readonly string[], icon: LucideIcon): Record<string, LucideIcon> =>
  Object.fromEntries(extensions.map((extension) => [extension, icon]));

const ICON_BY_EXTENSION: Record<string, LucideIcon> = {
  ...fill(CODE_EXTENSIONS, FileCode),
  ...fill(DOC_EXTENSIONS, FileText),
  ...fill(CONFIG_EXTENSIONS, Settings2),
  ...fill(IMAGE_EXTENSIONS, FileImage),
  ...fill(TABLE_EXTENSIONS, FileSpreadsheet),
  ...fill(DIFF_EXTENSIONS, FileDiff),
  ...fill(FONT_EXTENSIONS, FileType),
  json: FileJson,
  jsonc: FileJson,
  xml: Braces,
  lock: FileLock,
  log: ScrollText,
};

/** 无扩展名或不看扩展名的约定文件名 */
const ICON_BY_FILENAME: Record<string, LucideIcon> = {
  ".gitignore": FileLock,
  ".gitattributes": FileLock,
  ".npmrc": Settings2,
  ".nvmrc": Settings2,
  ".env": Settings2,
  dockerfile: Settings2,
  containerfile: Settings2,
  makefile: Settings2,
  license: FileLock,
};

/** 按路径取图标组件 */
export const fileIconOf = (path: string): LucideIcon => {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = ICON_BY_FILENAME[name];
  if (byName) return byName;
  // 锁文件看整名：`pnpm-lock.yaml`、`package-lock.json`、`Cargo.lock`、`bun.lockb` 都归它
  if (/lock\.(json|ya?ml|lockb)$/.test(name) || name.endsWith(".lock")) return FileLock;
  return ICON_BY_EXTENSION[extensionOf(path)] ?? FileDefault;
};
