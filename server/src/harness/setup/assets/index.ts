/**
 * 命令与技能装载：按 `commandAssetPaths` 的有序目录交给 pi 的 `DefaultResourceLoader`，
 * 再补上磁盘目录里没有的同名内置命令，读回后映射为不含绝对路径的视图（供 `/` 菜单与技能广告使用）。
 *
 * 会话装配（`harness/setup/session-config.ts`）用同一份目录与同一个 `promptsOverride`，
 * 保证「界面列出的」与「pi 实际能展开 / 广告的」是同一集合。
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

import {
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  type PromptTemplate,
  type ResourceDiagnostic,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import type {
  CommandAssetSource,
  CommandsListResponse,
  PromptCommandView,
  SkillCommandView,
} from "@ucode/contracts";

import { builtinPromptCommands } from "../../plugins/builtin";
import type { BuiltinPromptCommand } from "../../plugins/builtin/prompts";
import { type CommandAssetPath, type CommandAssetPathInput, commandAssetPaths } from "./paths";

export type { CommandAssetPath, CommandAssetPaths, PluginCommandAssets } from "./paths";
export { commandAssetPaths } from "./paths";

/** 内置命令的合成路径前缀；磁盘上不存在这个名字，只用来把来源标成 `builtin` */
const BUILTIN_PATH_PREFIX = "builtin:";

/** 内置命令的模板对象：路径是合成的（源码常量没有文件），`sourceInfo` 一并造出来 */
const toBuiltinTemplate = (command: BuiltinPromptCommand): PromptTemplate => {
  const filePath = `${BUILTIN_PATH_PREFIX}${command.name}`;
  return {
    name: command.name,
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    content: command.content,
    filePath,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "builtin" }),
  };
};

/**
 * 磁盘目录里没有被同名命令占用的内置命令。
 * 与提示词目录同一套优先级：项目 / 全局同名者胜，内置只补空缺。
 */
const builtinPrompts = (taken: readonly PromptTemplate[]): PromptTemplate[] => {
  const names = new Set(taken.map((template) => template.name));
  return builtinPromptCommands()
    .filter((command) => !names.has(command.name))
    .map(toBuiltinTemplate);
};

/**
 * `DefaultResourceLoader` 的 `promptsOverride`：把内置命令追加到磁盘命令之后。
 * 界面列举（`loadCommandAssets`）与实际展开（`harness/setup/session-config.ts`）共用这一份，
 * 否则「菜单里看得到」与「pi 认得」会不一致。
 */
export const withBuiltinPrompts = (base: {
  prompts: PromptTemplate[];
  diagnostics: ResourceDiagnostic[];
}): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } => ({
  prompts: [...base.prompts, ...builtinPrompts(base.prompts)],
  diagnostics: base.diagnostics,
});

/** 按最长前缀把文件路径归到某个来源目录；内置命令走合成路径，未命中回落最低档 */
export const sourceOf = (filePath: string, paths: CommandAssetPath[]): CommandAssetSource => {
  if (filePath.startsWith(BUILTIN_PATH_PREFIX)) return "builtin";
  let best: CommandAssetPath | null = null;
  for (const item of paths) {
    if (filePath === item.path || filePath.startsWith(`${item.path}${sep}`)) {
      if (!best || item.path.length > best.path.length) best = item;
    }
  }
  return best?.source ?? "global";
};

const toPromptView = (
  template: { name: string; description: string; argumentHint?: string; filePath: string },
  paths: CommandAssetPath[],
): PromptCommandView => ({
  name: template.name,
  description: template.description,
  ...(template.argumentHint ? { argumentHint: template.argumentHint } : {}),
  source: sourceOf(template.filePath, paths),
});

const toSkillView = (skill: Skill, paths: CommandAssetPath[]): SkillCommandView => ({
  name: skill.name,
  description: skill.description,
  source: sourceOf(skill.filePath, paths),
});

/**
 * 列举可用的提示词命令与技能。只读这些目录（禁用 pi 默认目录），
 * 同名时靠路径顺序决定（pi 侧 first-wins），内置命令排在最后。
 */
export const loadCommandAssets = async (
  input: CommandAssetPathInput & { harnessDir: string },
): Promise<CommandsListResponse> => {
  const paths = commandAssetPaths(input);
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.harnessDir,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noThemes: true,
    noContextFiles: true,
    noSkills: true,
    noPromptTemplates: true,
    additionalSkillPaths: paths.skills.map((item) => item.path),
    additionalPromptTemplatePaths: paths.prompts.map((item) => item.path),
    promptsOverride: withBuiltinPrompts,
  });
  await loader.reload();

  return {
    prompts: loader.getPrompts().prompts.map((template) => toPromptView(template, paths.prompts)),
    skills: loader.getSkills().skills.map((skill) => toSkillView(skill, paths.skills)),
  };
};

/** 技能索引里的一项：名字、`SKILL.md` 的归一化绝对路径、来源档位 */
export type SkillIndexEntry = {
  name: string;
  file: string;
  source: CommandAssetSource;
};

/** 本会话的技能索引：按名字与按文件路径两条路都能查到 */
export type SkillIndex = {
  list: SkillIndexEntry[];
  byFile: Map<string, SkillIndexEntry>;
  byName: Map<string, SkillIndexEntry>;
};

/**
 * 技能文件的比对口径：展开 `~`、相对路径按 cwd 解析、能取到 `realpath` 就用它。
 *
 * 模型给的路径可能是相对写法或 `~` 开头，而 pi 广告的是它自己解析出的路径；
 * 不归一就会出现「同一个文件两种写法对不上」。拿不到 `realpath`（文件已删 / 权限不足）时
 * 退化为字符串比较，不把命中判定卡在文件系统上。
 */
export const normalizeSkillFile = (filePath: string, cwd: string): string => {
  const expanded =
    filePath === "~" || filePath.startsWith("~/") ? `${homedir()}${filePath.slice(1)}` : filePath;
  const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
};

/**
 * 建本次会话的技能索引。广告给模型、`/skill:name` 展开、命中记录必须取自同一份索引——
 * 另起一次装载会让三处的集合不一致。
 */
export const skillIndexOf = (
  skills: readonly Skill[],
  paths: CommandAssetPath[],
  cwd: string,
): SkillIndex => {
  const list: SkillIndexEntry[] = skills.map((skill) => ({
    name: skill.name,
    file: normalizeSkillFile(skill.filePath, cwd),
    source: sourceOf(skill.filePath, paths),
  }));
  return {
    list,
    byFile: new Map(list.map((item) => [item.file, item])),
    byName: new Map(list.map((item) => [item.name, item])),
  };
};
