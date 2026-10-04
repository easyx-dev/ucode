/** commands 域的响应模型：提示词命令与技能（只给视图字段，不含绝对路径） */
import type { CommandAssetSource } from "../constants";

export type PromptCommandView = {
  /** 命令名；调用时序列化为 `/name` */
  name: string;
  /** 一句话说明，供菜单展示 */
  description: string;
  /** 参数提示，如 `[focus]`；无参数时缺省 */
  argumentHint?: string;
  /** 来源；同名时数组顺序靠前者胜 */
  source: CommandAssetSource;
};

export type SkillCommandView = {
  /** 技能名；显式调用序列化为 `/skill:name`，模型也可按描述自动选用 */
  name: string;
  description: string;
  source: CommandAssetSource;
};

export type CommandsListResponse = {
  prompts: PromptCommandView[];
  skills: SkillCommandView[];
};
