/**
 * 终端进程的环境：以宿主进程的环境为底，减去「不属于用户 shell」的那几类。
 *
 * 宿主就是用户从自己的终端（Ghostty / Terminal / iTerm）里起的本服务，它的环境 = 用户 shell 的
 * 环境 + 下面三类注入。终端要还原的是用户自己那个 shell（他敲 `pnpm dev` 时的环境），所以把注入的减去：
 *
 * 1. 包管理器的调用上下文：宿主是被 `pnpm start` 拉起的，于是带着 `npm_lifecycle_event`、
 *    `npm_execpath`、`npm_config_user_agent`、`INIT_CWD` 这类「我正在某个脚本里」的标记，
 *    且指向宿主那份包管理器与目录。用户在终端里自己敲 `pnpm dev` 时，pnpm 会重新注入正确的值。
 * 2. 本服务的配置与运行环境：`APP_*` / `SPIKE_*` 由 `env.ts` 的 `process.loadEnvFile()` 从
 *    `.env(.prod)` 灌进 `process.env`，`NODE_ENV` 由 `cli.ts` 兜底成 production，`NODE_PATH` /
 *    `NODE_OPTIONS` 是启动服务那个运行器（如 tsx）给自身注入的模块解析路径与选项，`SHLVL` 是
 *    服务被嵌套了几层 shell。它们都只有害处：vite 拿 `NODE_ENV` 而非自己的命令决定模式
 *    （`isProduction = process.env.NODE_ENV === "production"`），于是 `vite dev` 的
 *    `import.meta.env.DEV` 成了 `false`，按构建模式选分支的代码会走错路（dev 态该取 CJS interop
 *    的 `default`，却按构建态取命名空间），在页面上报出莫名其妙的错；`NODE_PATH` 会让终端里的
 *    node 优先从服务的 node_modules 解析模块，`NODE_OPTIONS` 会影响终端里每个 node 进程；
 *    `APP_HOME` / `APP_PORT` 则会让用户在终端里起的第二个实例读写同一个数据目录与端口，
 *    `SPIKE_API_KEY` 是白送给项目脚本的密钥。
 * 3. 宿主终端的外观：TERM 由 node-pty 定成 `xterm-256color`，而宿主那份 `TERMINFO` /
 *    `TERM_PROGRAM` 描述的是另一个终端程序，留着与 TERM 对不上。这是唯一一处刻意与用户的
 *    Ghostty 不同——内嵌终端是 xterm.js，不是 Ghostty，不能假装是它，否则程序会按 Ghostty 的
 *    能力发控制序列。
 *
 * 用减法而不是「只透传某几个变量」的白名单，是因为宿主环境本来就是用户的完整环境再加上述注入：
 * 白名单会漏掉用户环境里各工具链的变量，而用户 shell 自己 export 的东西本来就会由 `zsh -l`
 * 重新加载 profile 补回来。
 */

/** 包管理器与服务自身配置的命名空间：按前缀整片剔除 */
const DROPPED_PREFIXES = ["npm_", "pnpm_config_", "app_", "spike_"];

/** 逐个剔除的键（比较时统一小写，兼容 Windows 的大小写不敏感） */
const DROPPED_KEYS = new Set([
  // 包管理器注入的调用上下文
  "pnpm_script_src_dir",
  "init_cwd",
  // 宿主运行环境：运行模式、运行时为自身注入的模块解析与选项、shell 嵌套层级
  "node_env",
  "node_path",
  "node_options",
  "shlvl",
  // 宿主终端的外观
  "term",
  "terminfo",
  "term_program",
  "term_program_version",
  // 本服务若在 CI 里被拉起，用户的终端不该跟着变成 CI 模式（那会关掉进度与颜色）
  "ci",
  "continuous_integration",
]);

/** 清洗出一份能给终端用的环境；宿主缺值的键不落进结果 */
export const terminalEnvOf = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const normalized = key.toLowerCase();
    if (DROPPED_KEYS.has(normalized)) continue;
    if (DROPPED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) continue;
    result[key] = value;
  }
  return result;
};
