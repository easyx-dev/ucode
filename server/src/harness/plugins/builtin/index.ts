/**
 * 内置资产注册表：随包提供的提示词命令与技能，第三方插件共用同一套装载与优先级。
 *
 * 优先级恒为最低（磁盘 / 用户同名者胜出）；`kind` 决定接入方式——`prompt` 走内存合成的
 * `PromptTemplate`，`skill` 必须物化到磁盘（pi 的 `Skill` 只有文件路径，模型靠 `read` 取正文）。
 *
 * 云同步口子留在这里：`resolveBuiltinAssets()` 先取随包集合，中继可用时按 id 用云端版本替换；
 * 拉取失败或离线**静默回落**（云同步是可选增强，服务不因中继不可达而失败）。本轮只有随包一路。
 */
import { BUILTIN_PROMPT_COMMANDS, type BuiltinPromptCommand } from "./prompts";
import { BUILTIN_SKILLS, type BuiltinSkill } from "./skills";

/** 内置资产：真身与来源无关，来源只影响「从哪拿」与「能不能卸载」 */
export type BuiltinAsset =
  | {
      kind: "prompt";
      /** 身份：命令名 */
      id: string;
      version: string;
      command: BuiltinPromptCommand;
    }
  | (BuiltinSkill & { kind: "skill" });

/** 随包集合：提示词命令与技能各一路 */
export const PACKAGED_BUILTIN_ASSETS: readonly BuiltinAsset[] = [
  ...BUILTIN_PROMPT_COMMANDS.map(
    (command): BuiltinAsset => ({
      kind: "prompt",
      id: command.name,
      // 提示词命令是源码常量，随版本走；写死一个版本号只是为了让状态文件有一致的字段
      version: "0.1.0",
      command,
    }),
  ),
  ...BUILTIN_SKILLS.map((skill): BuiltinAsset => ({ kind: "skill", ...skill })),
];

/** 云同步口子：本轮恒为随包集合；接中继后在这里按 id 替换成云端版本 */
export const resolveBuiltinAssets = (): readonly BuiltinAsset[] => PACKAGED_BUILTIN_ASSETS;

/** 内置提示词命令：给装配层的 `promptsOverride` 用，顺序即同名优先级（这里只有内置一档） */
export const builtinPromptCommands = (
  assets: readonly BuiltinAsset[] = resolveBuiltinAssets(),
): BuiltinPromptCommand[] =>
  assets.filter((asset) => asset.kind === "prompt").map((asset) => asset.command);
