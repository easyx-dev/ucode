/** 资产（角色 / 技能 / 命令）相关的文件体积上限：设置页写入前的门槛，与运行时的读取门槛同量级 */
export const ASSET_MAX_BYTES = 256 * 1024;

/** 技能名：小写字母 / 数字，单连字符分段（pi 的 `SKILL.md` 命名规则） */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 命令名（文件名）：数字开头也可以，仍禁大写与点号 */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
