/**
 * 内置命令（前端动作）：`/` 菜单里「立即执行、不落正文」的一组。
 *
 * 与提示词命令 / 技能的区别：内置命令不产生 mention 节点，只在文档开头生效。
 * 需要正文参数的命令（`takesArgument`，如 `/goal <目标>`）选中后只把命令名填进输入框，等用户在正文里
 * 补参数；因此它们也不算「整条输入就是一个命令名」（见 `builtinCommandIdOf`）。
 * 文案 key 就是 `@ucode/i18n` ui 目录里的中文原文，调用处用 `t()` 取值。
 */
export type BuiltinCommandId =
  | "new"
  | "rename"
  | "archive"
  | "fork"
  | "stop"
  | "compact"
  | "models"
  | "thinking"
  | "mode"
  | "permission"
  | "settings"
  | "goal"
  | "help";

export type BuiltinCommand = {
  id: BuiltinCommandId;
  /** 命令名（不含前导 `/`） */
  name: string;
  /** 一句话说明（i18n key）：用作 `/` 菜单提示与 `/help` 清单 */
  descriptionKey: string;
  /** 是否要求存在当前会话：草稿态（无会话）不出现在菜单里 */
  needsSession: boolean;
  /** 参数由用户在正文里补：选中只填命令名，不立即执行 */
  takesArgument?: boolean;
  /** 参数提示，用于 `/` 菜单与 `/help` 清单；命令语法本身，保持英文子命令原样 */
  argumentHint?: string;
};

export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = [
  { id: "new", name: "new", descriptionKey: "开始一个新会话", needsSession: false }, // i18n-ignore
  { id: "rename", name: "rename", descriptionKey: "重命名当前会话", needsSession: true }, // i18n-ignore
  { id: "archive", name: "archive", descriptionKey: "归档当前会话", needsSession: true }, // i18n-ignore
  { id: "fork", name: "fork", descriptionKey: "从当前会话分叉", needsSession: true }, // i18n-ignore
  { id: "stop", name: "stop", descriptionKey: "中断当前生成", needsSession: true }, // i18n-ignore
  { id: "compact", name: "compact", descriptionKey: "压缩当前会话的上下文", needsSession: true }, // i18n-ignore
  { id: "models", name: "models", descriptionKey: "切换当前会话的模型", needsSession: false }, // i18n-ignore
  { id: "thinking", name: "thinking", descriptionKey: "切换思考档位", needsSession: false }, // i18n-ignore
  { id: "mode", name: "mode", descriptionKey: "切换助手模式", needsSession: false }, // i18n-ignore
  { id: "permission", name: "permission", descriptionKey: "切换权限档位", needsSession: true }, // i18n-ignore
  { id: "settings", name: "settings", descriptionKey: "打开设置", needsSession: false }, // i18n-ignore
  {
    id: "goal",
    name: "goal",
    descriptionKey: "查看或设定会话目标", // i18n-ignore
    needsSession: true,
    takesArgument: true,
    // i18n-ignore
    argumentHint: "目标文本 | status | pause | resume | clear",
  },
  { id: "help", name: "help", descriptionKey: "查看全部命令", needsSession: false }, // i18n-ignore
];

/**
 * 整条输入就是一个内置命令名（如 `/new`）时取其 id；带参数、参数型命令或不匹配都返回 null。
 * 参数型命令必须原样落到正文解析（`/goal` 的状态 / 暂停 / 恢复 / 清除由 `parseGoalCommand` 判定），
 * 所以这里不认它们——否则 `/goal` 会被就地执行掉，用户没机会写目标文本。
 */
export const builtinCommandIdOf = (text: string): BuiltinCommandId | null => {
  const match = /^\/([a-z][a-z0-9-]*)\s*$/.exec(text.trim());
  if (!match) return null;
  const command = BUILTIN_COMMANDS.find((item) => item.name === match[1]);
  return command && command.takesArgument !== true ? command.id : null;
};
