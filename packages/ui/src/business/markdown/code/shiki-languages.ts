/**
 * 语法高亮的语言表与纯判定：不含任何 shiki 运行时依赖。
 *
 * 单独一个模块是为了让「预览某个文件该用哪种语言」「值不值得高亮」这类判断能同步、零成本取到——
 * 真正会加载 shiki 引擎的 `business/markdown/shiki.ts` 是**动态导入**的，不预览代码就不会下载高亮器。
 */
import { extensionOf } from "../../../utils/preview";

/** 超过这两个阈值就不高亮，直接铺纯文本（避免大文件卡住主线程） */
export const HIGHLIGHT_MAX_LINES = 3_000;
export const HIGHLIGHT_MAX_CHARS = 200_000;

/**
 * 支持的语言：键是 shiki 的语言 id，值是它自己的 chunk。
 * 只需要覆盖「会点开看」的常见类型；表外的扩展名一律纯文本，不报错。
 */
export const LANGS: Record<string, () => Promise<unknown>> = {
  bash: () => import("@shikijs/langs/shellscript"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  elixir: () => import("@shikijs/langs/elixir"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  hcl: () => import("@shikijs/langs/hcl"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  less: () => import("@shikijs/langs/less"),
  lua: () => import("@shikijs/langs/lua"),
  make: () => import("@shikijs/langs/make"),
  markdown: () => import("@shikijs/langs/markdown"),
  mermaid: () => import("@shikijs/langs/mermaid"),
  nginx: () => import("@shikijs/langs/nginx"),
  perl: () => import("@shikijs/langs/perl"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  proto: () => import("@shikijs/langs/proto"),
  python: () => import("@shikijs/langs/python"),
  r: () => import("@shikijs/langs/r"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  zig: () => import("@shikijs/langs/zig"),
};

/** 扩展名 → 语言 id；认不出的返回 null（渲染器据此走纯文本） */
const LANG_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  svelte: "svelte",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  env: "ini",
  properties: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  sql: "sql",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  lua: "lua",
  dart: "dart",
  scala: "scala",
  r: "r",
  pl: "perl",
  pm: "perl",
  ps1: "powershell",
  proto: "proto",
  gql: "graphql",
  graphql: "graphql",
  tf: "hcl",
  hcl: "hcl",
  nginx: "nginx",
  ex: "elixir",
  exs: "elixir",
  zig: "zig",
  diff: "diff",
  patch: "diff",
};

/** 无扩展名的常见文件名 → 语言 id */
const LANG_BY_FILENAME: Record<string, string> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "make",
  ".gitignore": "ini",
  ".npmrc": "ini",
  ".editorconfig": "ini",
};

/**
 * 常见别名 → 语言 id。Markdown 的 fenced code 标注习惯写 `ts` / `js` / `py` 这类短名，
 * 而 shiki 的 id 是 `typescript` / `javascript` / `python`，这里补一层归一。
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  rs: "rust",
  kt: "kotlin",
  rb: "ruby",
  cs: "csharp",
  "c++": "cpp",
  golang: "go",
  md: "markdown",
  dockerfile: "docker",
  tf: "hcl",
  ps1: "powershell",
  gql: "graphql",
  vue: "vue",
  svelte: "svelte",
};

/** 按路径推断 shiki 语言；认不出返回 null */
export const languageOfPath = (path: string): string | null => {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = LANG_BY_FILENAME[name];
  if (byName) return byName;
  const extension = extensionOf(path);
  return extension ? (LANG_BY_EXTENSION[extension] ?? null) : null;
};

/**
 * 把任意语言标注归一成 shiki 的语言 id：已注册的 id 直用，其余过一层别名表。
 * 认得但不在语言表内的（生僻类型）返回 null，由调用方铺纯文本。
 */
export const resolveLanguageId = (language: string | null | undefined): string | null => {
  const raw = language?.trim().toLowerCase();
  if (!raw) return null;
  if (LANGS[raw]) return raw;
  const alias = LANGUAGE_ALIASES[raw] ?? LANG_BY_EXTENSION[raw] ?? null;
  return alias && LANGS[alias] ? alias : null;
};

/** 代码是否值得高亮：超长文件与认不出语言的文件都退回纯文本 */
export const shouldHighlight = (code: string, language: string | null): boolean =>
  language !== null &&
  code.length <= HIGHLIGHT_MAX_CHARS &&
  code.split("\n").length <= HIGHLIGHT_MAX_LINES;
