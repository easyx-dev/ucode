/**
 * CLI 的命令面：命令、选项与位置参数都只在这里声明一处。
 *
 * 帮助文本、shell 补全与参数校验都从这份表生成——新增一个命令只改这里与分发处，
 * 不会出现「补全里有、帮助里没有」这类漂移。
 */
export type CliOptionName = "port" | "host" | "open" | "json" | "lines" | "follow";

export type CliOption = {
  /** 内部名称：命令表按它声明自己的选项集 */
  name: CliOptionName;
  /** 长选项（不含 `--`） */
  long: string;
  short?: string;
  /** `string` 表示需要取值 */
  type: "string" | "boolean";
  /** 取值占位，仅 `string` 有 */
  placeholder?: string;
  /** 选项说明 */
  description: string;
};

export const CLI_OPTIONS: readonly CliOption[] = [
  {
    name: "port",
    long: "port",
    short: "p",
    type: "string",
    placeholder: "<端口>",
    description: "监听端口（覆盖环境配置；0 表示自选可用端口）",
  },
  {
    name: "host",
    long: "host",
    type: "string",
    placeholder: "<地址>",
    description: "监听地址（覆盖环境配置）",
  },
  { name: "open", long: "open", type: "boolean", description: "启动后打开浏览器" },
  { name: "json", long: "json", type: "boolean", description: "输出 JSON，便于脚本解析" },
  {
    name: "lines",
    long: "lines",
    short: "n",
    type: "string",
    placeholder: "<行数>",
    description: "打印的行数（默认 200）",
  },
  {
    name: "follow",
    long: "follow",
    short: "f",
    type: "boolean",
    description: "跟随输出，Ctrl-C 退出",
  },
];

export type CliCommand = {
  name: string;
  /** 一行摘要 */
  summary: string;
  /** 位置参数写法（不含命令名），只在单项帮助里出现 */
  positional?: string;
  /** 位置参数候选，补全用 */
  values?: readonly string[];
  /** 该命令接受的选项；不在其中的写法一律报错 */
  options: readonly CliOptionName[];
};

/** 顺序即帮助里的展示顺序：默认命令在前，`service` 与 `help` 收尾 */
export const CLI_COMMANDS: readonly CliCommand[] = [
  { name: "serve", summary: "前台启动（默认命令）", options: ["port", "host", "open"] },
  { name: "start", summary: "后台启动；已在运行则只打印地址", options: ["port", "host", "open"] },
  { name: "restart", summary: "重启后台实例", options: ["port", "host", "open"] },
  { name: "stop", summary: "结束后台实例", options: [] },
  { name: "status", summary: "查询是否在运行（退出码 0 表示运行中）", options: ["json"] },
  {
    name: "logs",
    summary: "查看后台实例日志（$APP_HOME/app/service.log）",
    options: ["lines", "follow"],
  },
  { name: "open", summary: "在浏览器打开正在运行的实例", options: [] },
  { name: "doctor", summary: "自检安装与运行环境", options: ["json"] },
  { name: "password", summary: "打印登录密码与注册文件路径", options: [] },
  { name: "update", summary: "查 npm 上的最新版本（只提示，不自动安装）", options: ["json"] },
  { name: "version", summary: "打印版本（等同 --version）", options: [] },
  {
    name: "completion",
    summary: "输出 shell 补全脚本",
    positional: "bash | zsh | fish",
    values: ["bash", "zsh", "fish"],
    options: [],
  },
  {
    name: "service",
    summary: "service start | restart | stop | status（与上面的快捷命令等价）",
    positional: "start | restart | stop | status",
    values: ["start", "restart", "stop", "status"],
    options: ["port", "host", "open", "json"],
  },
  { name: "help", summary: "打印帮助；help <命令> 看单项说明", positional: "[命令]", options: [] },
];

export const findCommand = (name: string): CliCommand | undefined =>
  CLI_COMMANDS.find((command) => command.name === name);

/** 选项名 → 选项定义；命令表与解析器都按名字取 */
export const findOption = (name: CliOptionName): CliOption => {
  const option = CLI_OPTIONS.find((candidate) => candidate.name === name);
  if (!option) throw new Error(`未声明的选项：${name}`);
  return option;
};

/** 某个命令接受的选项（按命令行里的展示顺序） */
export const optionsOf = (command: CliCommand): CliOption[] =>
  CLI_OPTIONS.filter((option) => command.options.includes(option.name));

export const commandNames = (): string[] => CLI_COMMANDS.map((command) => command.name);
