/** commands 域的响应模型：提示词命令与技能（只给视图字段，不含绝对路径） */
import type { CommandAssetSource } from "../constants";

export type PromptCommandView = {
  /** 命令名；调用时序列化为 `/name` */
  name: string;
  /** 一句话说明，供菜单展示 */
  description: string;
  /** 参数提示，如 `[focus]`；无参数时缺省 */
  argumentHint?: string;
  /** 模板正文的 UTF-8 字节数：界面据此估计这条输入会往上下文里塞多少 */
  bytes: number;
  /** 来源；同名时数组顺序靠前者胜 */
  source: CommandAssetSource;
};

export type SkillCommandView = {
  /** 技能名；显式调用序列化为 `/skill:name`，模型也可按描述自动选用 */
  name: string;
  description: string;
  /** 技能正文（SKILL.md）的 UTF-8 字节数：一条消息可以带多条技能，界面据此提示上下文占用 */
  bytes: number;
  source: CommandAssetSource;
};

export type CommandsListResponse = {
  prompts: PromptCommandView[];
  skills: SkillCommandView[];
};
