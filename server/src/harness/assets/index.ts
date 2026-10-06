/**
 * 命令与技能装载：按 `commandAssetPaths` 的有序目录交给 pi 的 `DefaultResourceLoader`，
 * 读回后映射为不含绝对路径的视图（供 `/` 菜单与技能广告使用）。
 *
 * 会话装配（`harness/session-config.ts`）用同一份路径给 resourceLoader，保证「界面列出的」与
 * 「pi 实际能展开 / 广告的」是同一集合。
 */
import { sep } from "node:path";

import {
  DefaultResourceLoader,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import type {
  CommandAssetSource,
  CommandsListResponse,
  PromptCommandView,
  SkillCommandView,
} from "@ucode/contracts";

import { type CommandAssetPath, type CommandAssetPathInput, commandAssetPaths } from "./paths";

export type { CommandAssetPath, CommandAssetPaths } from "./paths";
export { commandAssetPaths } from "./paths";

/** 按最长前缀把文件路径归到某个来源目录；理论上必命中，未命中回落最低档 */
const sourceOf = (filePath: string, paths: CommandAssetPath[]): CommandAssetSource => {
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
 * 同名时靠路径顺序决定（pi 侧 first-wins）。
 */
export const loadCommandAssets = async (
  input: CommandAssetPathInput & { harnessDir: string },
): Promise<CommandsListResponse> => {
  const paths = commandAssetPaths(input);
  if (paths.skills.length === 0 && paths.prompts.length === 0) {
    return { prompts: [], skills: [] };
  }

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
  });
  await loader.reload();

  return {
    prompts: loader.getPrompts().prompts.map((template) => toPromptView(template, paths.prompts)),
    skills: loader.getSkills().skills.map((skill) => toSkillView(skill, paths.skills)),
  };
};
