/**
 * 资产目录口径：三类资产的来源目录枚举、写入落点解析与路径归属判定。
 *
 * 目录清单复用运行时的解析（角色的 `agentDirs`、技能与命令的 `commandAssetPaths`），
 * 保证「设置页看到的」与「会话里装载的」是同一批目录；写入落点另算——目标目录常常还不存在，
 * 不能复用那两份「只列已存在目录」的解析。
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { AssetKind, AssetScope, CommandAssetSource } from "@ucode/contracts";
import { ERROR_CODES } from "@ucode/contracts";

import {
  AGENTS_DIRNAME,
  MARKDOWN_EXTENSION,
  PROJECT_CONFIG_DIRNAME,
  PROMPTS_DIRNAME,
  SKILL_FILENAME,
  SKILLS_DIRNAME,
} from "../../constants/dirs";
import type { PluginAgentFile } from "../../harness/plugins/types";
import { agentDirs } from "../../harness/setup/agents";
import type { PluginCommandAssets } from "../../harness/setup/assets";
import { commandAssetPaths } from "../../harness/setup/assets";
import { ancestorDirs, isInsidePath } from "../../platform/paths";
import { AppError } from "../../platform/response";

/** 一个来源目录：来源档位决定同名优先级，作用域决定能不能写 */
export type AssetSourceDir = {
  kind: AssetKind;
  dir: string;
  source: CommandAssetSource;
  /** 可写档（全局 / 项目）才有；插件、内置与兼容目录缺省 */
  scope?: AssetScope;
};

export type AssetContext = {
  /** 会话工作目录：项目档的起点，也是祖先链解析的输入 */
  cwd: string;
  /** `$APP_HOME`：全局档的父目录 */
  appHome: string;
  /** 用户主目录：祖先链的终点；缺省取 `os.homedir()`，测试可覆盖 */
  userHome?: string;
  /** 启用插件贡献的技能 / 命令目录 */
  plugin?: PluginCommandAssets;
  /** 启用插件声明的子角色（只读：插件角色没有可写文件） */
  pluginAgents?: readonly PluginAgentFile[];
};

/** 各资产类别对应的目录名 */
const KIND_DIRNAME: Record<AssetKind, string> = {
  agent: AGENTS_DIRNAME,
  skill: SKILLS_DIRNAME,
  command: PROMPTS_DIRNAME,
};

/** 来源档位 → 写入作用域；只读来源没有作用域 */
export const scopeOf = (source: CommandAssetSource): AssetScope | undefined =>
  source === "global" || source === "project" ? source : undefined;

/**
 * 项目档的配置目录：cwd 祖先链上最近的**已存在** `.<slug>`；一个都没有时落在 cwd 下。
 *
 * 遇到 `$APP_HOME` 要跳过：未绑定项目的会话 cwd 就在 `$APP_HOME/workspace/<id>` 下，
 * 而 `$APP_HOME` 本身就是 `.<slug>` 形态——不跳过就会把全局档当成项目档，两者指向同一目录。
 */
export const projectConfigDirOf = (ctx: AssetContext): string => {
  const userHome = resolve(ctx.userHome ?? homedir());
  const appHome = resolve(ctx.appHome);
  for (const dir of ancestorDirs(ctx.cwd, [userHome])) {
    if (dir === userHome) break;
    const candidate = join(dir, PROJECT_CONFIG_DIRNAME);
    if (dir === appHome || candidate === appHome) continue;
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  return join(resolve(ctx.cwd), PROJECT_CONFIG_DIRNAME);
};

/** 写入落点：全局 `$APP_HOME/<域目录>`，或项目配置目录下的同名目录；目录不要求存在 */
export const assetWriteDirOf = (ctx: AssetContext, kind: AssetKind, scope: AssetScope): string =>
  scope === "global"
    ? resolve(ctx.appHome, KIND_DIRNAME[kind])
    : join(projectConfigDirOf(ctx), KIND_DIRNAME[kind]);

/** 三类资产的来源目录（只含已存在的目录），顺序即同名优先级；同一目录只算一条 */
export const assetSourceDirs = (ctx: AssetContext): AssetSourceDir[] => {
  const dirs: AssetSourceDir[] = [];
  const seen = new Set<string>();
  const push = (item: AssetSourceDir): void => {
    const dir = resolve(item.dir);
    const key = `${item.kind}:${dir}`;
    if (seen.has(key)) return;
    seen.add(key);
    dirs.push({ ...item, dir });
  };

  for (const item of agentDirs({ cwd: ctx.cwd, appHome: ctx.appHome, userHome: ctx.userHome })) {
    push({ kind: "agent", dir: item.dir, source: item.source, scope: scopeOf(item.source) });
  }
  const paths = commandAssetPaths({
    cwd: ctx.cwd,
    appHome: ctx.appHome,
    userHome: ctx.userHome,
    plugin: ctx.plugin,
  });
  for (const item of paths.skills) {
    push({ kind: "skill", dir: item.path, source: item.source, scope: scopeOf(item.source) });
  }
  for (const item of paths.prompts) {
    push({ kind: "command", dir: item.path, source: item.source, scope: scopeOf(item.source) });
  }
  return dirs;
};

/**
 * 路径在该目录内的形态：角色与命令是目录下的一级 `.md`，技能是 `<name>/SKILL.md`。
 * 形态不符返回 null——`SKILL.md` 的引用文件、命令子目录都不算可管理的资产。
 */
const assetNameOf = (kind: AssetKind, root: string, target: string): string | null => {
  const parts = relative(root, target).split(sep);
  if (kind === "skill") {
    return parts.length === 2 && parts[1] === SKILL_FILENAME ? (parts[0] ?? null) : null;
  }
  const file = parts[0];
  if (parts.length !== 1 || !file?.endsWith(MARKDOWN_EXTENSION)) return null;
  return file.slice(0, -MARKDOWN_EXTENSION.length);
};

/**
 * 按**路径形态**认项目档：任一层是 `.<slug>`、且紧邻其下就是本类别的目录。
 *
 * `read` / `delete` 给的是绝对路径，不该再要求调用方把 cwd 一并带上——路径自身就能说明
 * 它属于哪个项目档；而 ctx 里的来源目录只覆盖调用方所在的那一份。
 */
const projectRootOf = (kind: AssetKind, target: string): string | null => {
  const segments = target.split(sep);
  const index = segments.lastIndexOf(PROJECT_CONFIG_DIRNAME);
  if (index < 0 || segments[index + 1] !== KIND_DIRNAME[kind]) return null;
  return segments.slice(0, index + 2).join(sep);
};

/** 一条磁盘路径的归属：来源目录、来源档位、可否写入与资产名；不在任何资产目录内返回 null */
export type AssetPathInfo = {
  kind: AssetKind;
  /** 归一化后的绝对路径 */
  path: string;
  /** 命中的来源目录 */
  dir: string;
  source: CommandAssetSource;
  scope?: AssetScope;
  editable: boolean;
  name: string;
};

const infoOf = (
  kind: AssetKind,
  target: string,
  dir: string,
  source: CommandAssetSource,
): AssetPathInfo | null => {
  const name = assetNameOf(kind, dir, target);
  if (!name) return null;
  const scope = scopeOf(source);
  return {
    kind,
    path: target,
    dir,
    source,
    ...(scope ? { scope } : {}),
    editable: scope !== undefined,
    name,
  };
};

export const assetPathInfo = (
  ctx: AssetContext,
  kind: AssetKind,
  path: string,
): AssetPathInfo | null => {
  const target = resolve(path);
  let best: AssetSourceDir | null = null;
  for (const item of assetSourceDirs(ctx)) {
    if (item.kind !== kind || !isInsidePath(item.dir, target)) continue;
    // 目录可能嵌套（项目配置目录在项目内、插件目录在插件根内），取最深的那个
    if (!best || item.dir.length > best.dir.length) best = item;
  }
  if (best) return infoOf(kind, target, best.dir, best.source);

  const projectRoot = projectRootOf(kind, target);
  return projectRoot ? infoOf(kind, target, projectRoot, "project") : null;
};

/**
 * 写入前的路径校验：目标必须落在允许目录内，且其已存在的最近祖先经 realpath 后仍在目录内。
 *
 * 后者防的是「目录里有指向外部的符号链接」——纯字符串前缀比较看不出这种情况，
 * 而这里的目标文件通常还不存在，取不到自身的 realpath，只能沿父目录往上找。
 */
export const assertWritableTarget = (root: string, target: string): void => {
  if (!isInsidePath(root, target)) {
    throw new AppError(ERROR_CODES.assetNameInvalid, `资产名不合法：${target}`, 400, undefined, {
      reason: "名字里含路径分隔符或上级目录",
    });
  }
  if (!existsSync(root)) return;
  let probe = dirname(target);
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realRoot = realpathSync(root);
  if (existsSync(probe) && !isInsidePath(realRoot, realpathSync(probe))) {
    throw new AppError(
      ERROR_CODES.assetReadOnly,
      `资产目录指向了别处（符号链接），已拒绝写入：${root}`,
      400,
      undefined,
      { path: root },
    );
  }
};
