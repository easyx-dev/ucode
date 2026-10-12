/**
 * 命令与技能的目录解析：全局 + 项目祖先链 + `.agents` 兼容，按同名优先级排序。
 *
 * pi 的装载是 first-wins（先加载者胜），所以这里的数组顺序即优先级：项目配置目录 >
 * 项目 `.agents` > 全局 `$APP_HOME` > 用户 `~/.agents`；同一级别内目录离 cwd 近者优先。
 */
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { CommandAssetSource } from "@ucode/contracts";

import {
  AGENTS_COMPAT_DIRNAME,
  APP_DIRNAME,
  BUILTIN_DIRNAME,
  PROJECT_CONFIG_DIRNAME,
  PROMPTS_DIRNAME,
  SKILLS_DIRNAME,
} from "../../../constants/dirs";
import { ancestorDirs } from "../../../platform/paths";
import type { PluginCommandAssets } from "../../plugins/types";

export type CommandAssetPath = {
  /** 已归一化为绝对路径的目录 */
  path: string;
  /** 来源，决定同名时的优先级 */
  source: CommandAssetSource;
};

export type CommandAssetPaths = {
  /** 技能目录，按同名优先级从高到低 */
  skills: CommandAssetPath[];
  /** 提示词命令目录，按同名优先级从高到低 */
  prompts: CommandAssetPath[];
};

export type CommandAssetPathInput = {
  /** 会话工作目录 */
  cwd: string;
  /** `$APP_HOME`：全局 `skills` / `prompts` 的父目录 */
  appHome: string;
  /** 用户主目录，`~/.agents/skills` 的父目录；缺省取 `os.homedir()`，测试可覆盖 */
  userHome?: string;
  /**
   * 启用插件贡献的技能 / 命令目录。由调用方从插件注册表算出后传进来——
   * 装配层不反向依赖插件宿主（见 AGENTS.md 的 layers 约束）。
   */
  plugin?: PluginCommandAssets;
};

/** 插件贡献的技能 / 命令目录的类型在插件宿主（`harness/plugins/types`），这里只透传 */
export type { PluginCommandAssets };

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** 去重并丢弃不存在的目录；first-wins，保留靠前的来源标签 */
const existingUnique = (items: CommandAssetPath[]): CommandAssetPath[] => {
  const seen = new Set<string>();
  const result: CommandAssetPath[] = [];
  for (const item of items) {
    const path = resolve(item.path);
    if (seen.has(path) || !isDirectory(path)) continue;
    seen.add(path);
    result.push({ path, source: item.source });
  }
  return result;
};

export const commandAssetPaths = (input: CommandAssetPathInput): CommandAssetPaths => {
  const userHome = resolve(input.userHome ?? homedir());
  const appHome = resolve(input.appHome);
  // 主目录这一级由「全局 / 用户」两档负责，避免在项目档里被误标成 project
  const dirs = ancestorDirs(input.cwd, [userHome]).filter(
    (dir) => dir !== userHome && dir !== appHome,
  );

  // 插件的技能 / 命令目录排在用户档之后：同名时用户手写的仍胜出，内置资产恒垫底
  const pluginPaths = (paths: readonly string[] | undefined): CommandAssetPath[] =>
    (paths ?? []).map((path) => ({ path, source: "plugin" as const }));

  const projectConfigSubdirs = (sub: string, source: CommandAssetSource): CommandAssetPath[] =>
    dirs.map((dir) => ({ path: resolve(dir, PROJECT_CONFIG_DIRNAME, sub), source }));
  const agentsSubdirs = (sub: string, source: CommandAssetSource): CommandAssetPath[] =>
    dirs.map((dir) => ({ path: resolve(dir, AGENTS_COMPAT_DIRNAME, sub), source }));

  const skills = existingUnique([
    ...projectConfigSubdirs(SKILLS_DIRNAME, "project"),
    ...agentsSubdirs(SKILLS_DIRNAME, "agents-project"),
    { path: resolve(appHome, SKILLS_DIRNAME), source: "global" },
    { path: resolve(userHome, AGENTS_COMPAT_DIRNAME, SKILLS_DIRNAME), source: "agents-user" },
    ...pluginPaths(input.plugin?.skills),
    // 内置技能物化在 `$APP_HOME/app/builtin/skills`：恒为最后一档，磁盘 / 用户同名者胜出
    { path: resolve(appHome, APP_DIRNAME, BUILTIN_DIRNAME, SKILLS_DIRNAME), source: "builtin" },
  ]);

  const prompts = existingUnique([
    ...projectConfigSubdirs(PROMPTS_DIRNAME, "project"),
    { path: resolve(appHome, PROMPTS_DIRNAME), source: "global" },
    ...pluginPaths(input.plugin?.prompts),
  ]);

  return { skills, prompts };
};
