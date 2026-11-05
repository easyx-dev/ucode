/** 工具侧上限：联网抓取与搜索、agent 的 shell、`@` 引用展开，以及 fs / git 两域路由的读上限 */
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import { brand } from "@ucode/brand/values";

/** webfetch 未指定 timeout 时的超时（30s） */
export const WEBFETCH_DEFAULT_TIMEOUT_MS = 30_000;

/** webfetch 的 timeout 上限（120s） */
export const WEBFETCH_MAX_TIMEOUT_MS = 120_000;

/** webfetch 单次响应体的字节上限，超出即截断 */
export const WEBFETCH_MAX_BYTES = 5 * 1024 * 1024;

/** webfetch 交给模型的正文字节上限：与 pi 内置工具同档，避免大页面直接撑爆上下文 */
export const WEBFETCH_MAX_OUTPUT_BYTES = DEFAULT_MAX_BYTES;

/** webfetch 跟随重定向的最大跳数，每一跳都重新做地址准入 */
export const WEBFETCH_MAX_REDIRECTS = 5;

/** webfetch 的 User-Agent：带上品牌标识，便于站点侧识别来源（品牌串从品牌包取） */
export const WEBFETCH_USER_AGENT = `${brand.slug}-webfetch/1.0`;

/** websearch 单次返回条数上限 */
export const WEBSEARCH_MAX_RESULTS = 10;

/** websearch 单次请求的超时 */
export const WEBSEARCH_TIMEOUT_MS = 20_000;

/** agent 侧 shell 命令的总时长上限（秒）；模型可用 `timeout` 参数放宽 */
export const SHELL_COMMAND_TIMEOUT_SECONDS = 30 * 60;

/** agent 侧 shell 命令连续无输出的时长上限；到达即判定为等待交互输入并中止 */
export const SHELL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** shell 命令里允许出现的固定空等（秒）：这以上的 `sleep` 直接拦下，让模型改用工具自身的等待能力 */
export const SHELL_SLEEP_MIN_SECONDS = 1;

/** 后台服务单端口探活的连接超时 */
export const SERVICE_PROBE_TIMEOUT_MS = 300;

/**
 * 后台服务的「执行后」探测窗口：命令返回时服务往往还没 listen（`pnpm dev &` 立即返回），
 * 所以在窗口内按间隔重试，直到能连上或超预算
 */
export const SERVICE_PROBE_RETRY_WINDOW_MS = 1_000;

/** 后台服务「执行后」探测的重试间隔 */
export const SERVICE_PROBE_RETRY_INTERVAL_MS = 100;

/** 判定后台服务时旁路保留的命令输出上限（只用于找端口线索） */
export const SERVICE_OUTPUT_CAPTURE_MAX_BYTES = 64 * 1024;

/** 单会话追踪的后台服务条数上限；超出时丢最旧的已停止项，监听中的一律保留 */
export const SERVICE_MAX_TRACKED_PER_SESSION = 20;

/** 后台服务清单里命令原文的展示长度上限 */
export const SERVICE_COMMAND_MAX_CHARS = 200;

/** `@` 单次引用的文件数上限（目录展开后一并计入） */
export const CONTEXT_MAX_FILES = 64;

/** `@` 单个文件的读取字节上限 */
export const CONTEXT_MAX_FILE_BYTES = 200 * 1024;

/** `@` 单次引用的总字节上限 */
export const CONTEXT_MAX_TOTAL_BYTES = 512 * 1024;

/** fs/search 单次扫描的条目上限（交给 pi find 的 limit）；超出即标注截断 */
export const FS_SEARCH_MAX_SCAN = 20_000;

/** fs/read 判定二进制时嗅探的字节数：这段里出现 NUL 即当二进制 */
export const FS_BINARY_SNIFF_BYTES = 8 * 1024;

/** fs/read 内联文本的字节上限，超出按上限截断 */
export const FS_READ_TEXT_MAX_BYTES = 1024 * 1024;

/** fs/read 内联 base64 的字节上限，超出整块不返回（图 / PDF / Word 预览用） */
export const FS_READ_BINARY_MAX_BYTES = 5 * 1024 * 1024;

/** fs/search 跳过的目录名 */
export const FS_SEARCH_SKIP_DIRS = ["node_modules", ".git", "dist", ".next", ".turbo", ".cache"];

/** git 命令的单次执行超时；仓库过大或磁盘卡死时不让请求悬着 */
export const GIT_TIMEOUT_MS = 10_000;

/** git 命令的输出缓冲上限 */
export const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** 单次 diff 返回的行数上限（hunk 内容行，不含头部），超出即截断 */
export const GIT_DIFF_MAX_LINES = 5_000;

/** git/status 返回的变更条目上限 */
export const GIT_STATUS_MAX_FILES = 1_000;

/** 变更列表里最多展开这么多个子模块；超出的按 git 自己的报告呈现，避免仓库挂了几十个子模块时拖慢 status */
export const GIT_SUBMODULE_MAX = 20;

/** git/show 返回的文件条数上限 */
export const GIT_SHOW_MAX_FILES = 500;
