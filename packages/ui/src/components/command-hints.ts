/**
 * 命令提示的**纯逻辑**（对齐 zcode 的 "命令与能力" 面板）。
 *
 * 只列**本壳真的会执行**的命令。
 *
 * zcode 的面板还有「技能」「子智能体」两段，这里刻意没有：服务层的引用展开目前只支持
 * `file` / `folder`（其余类型会抛 `UnsupportedReferenceError`），把它们列出来点一下就会失败——
 * 那是一句谎话。技能与子智能体在「插件」面板里可看可装，面板底部如实指路。
 */

export type SlashCommand = {
  name: string;
  /** 参数占位；没有参数则省略。 */
  args?: string;
  description: string;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/help", description: "显示命令帮助" },
  { name: "/new", args: "[目录]", description: "新建会话" },
  { name: "/compact", args: "[说明]", description: "压缩当前上下文" },
  { name: "/model", description: "打开模型配置（供应商 / 端点 / 密钥）" },
  {
    name: "/autonomy",
    args: "<级别>",
    description: "执行模式：confirm | auto-edit | plan | full-access",
  },
  { name: "/tasks", description: "打开自动化任务面板" },
  { name: "/plugins", description: "打开插件与技能面板" },
  { name: "/usage", description: "打开用量 / 导出 / 迁移面板" },
];

/** 面板标题与副标题：与 zcode 同一处措辞，用户在两处看到的是一句话。 */
export const COMMAND_PANEL_TITLE = "命令与能力";
export const COMMAND_PANEL_HINT = "输入内容以搜索命令";

export function usageOf(command: SlashCommand): string {
  return command.args === undefined ? command.name : `${command.name} ${command.args}`;
}

/**
 * 当前输入里"正在写的那个命令词"。
 *
 * 只在整段输入以 `/` 开头、且**还没进到参数**时返回（`/mod`、`/`）；
 * 一旦有空格（`/new /tmp`）就返回 null——那时该提示的是参数取值，
 * 拿一屏命令名盖住用户正在看的内容只会碍事。
 */
export function activeCommandToken(input: string): string | null {
  const text = input;
  if (!text.startsWith("/")) return null;
  if (text.includes(" ") || text.includes("\n")) return null;
  return text;
}

/** 按前缀过滤命令。`activeCommandToken` 为 null 时返回空数组。 */
export function matchCommands(input: string): SlashCommand[] {
  const token = activeCommandToken(input);
  if (token === null) return [];
  const needle = token.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(needle));
}

/**
 * 把一行输入拆成命令与参数。
 *
 * 返回 null 表示"这不是命令"（不是以 `/` 开头，或只是孤零零一个 `/`）——
 * 后者要当作普通消息，否则用户敲了个斜杠就没法正常说话了。
 */
export function parseSlashCommand(input: string): { name: string; args: string[] } | null {
  const text = input.trim();
  if (!text.startsWith("/")) return null;
  const [rawName = "", ...args] = text.split(/\s+/);
  if (rawName === "/") return null;
  return { name: rawName.toLowerCase(), args };
}

/** 命令的用法说明，用于"参数不对"时回一句能照做的话。 */
export function commandUsage(name: string): string | null {
  const command = SLASH_COMMANDS.find((candidate) => candidate.name === name);
  return command === undefined ? null : usageOf(command);
}
