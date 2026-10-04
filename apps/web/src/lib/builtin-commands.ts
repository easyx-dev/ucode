/**
 * 内置命令（前端动作）：`/` 菜单里「立即执行、不落正文」的一组。
 *
 * 与提示词命令 / 技能的区别：内置命令不做任何文本插入，选中即触发对应界面动作；
 * 因此只在文档开头生效、且不产生 mention 节点。这里只列 UI 能完整执行的命令。
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
  { id: "settings", name: "settings", descriptionKey: "打开设置", needsSession: false }, // i18n-ignore
  { id: "goal", name: "goal", descriptionKey: "查看或设定会话目标", needsSession: true }, // i18n-ignore
  { id: "help", name: "help", descriptionKey: "查看全部命令", needsSession: false }, // i18n-ignore
];
