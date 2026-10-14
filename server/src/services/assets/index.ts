/**
 * 资产管理：列出角色 / 技能 / 命令三类资产，并支持读详情、新建或覆盖、删除。
 *
 * 只写两档：全局 `$APP_HOME` 与当前项目（cwd 祖先链上最近的配置目录）。插件、内置与
 * `.agents` 兼容目录来的条目只读——改它们要么改插件，要么在可写档里放一份同名的盖住。
 * 保存前用运行时同一套解析做校验，保证写出去的文件一定能被会话装配装载。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  ASSET_NAME_MAX_LENGTH,
  type AssetDeleteResponse,
  type AssetDetail,
  type AssetError,
  type AssetKind,
  type AssetSaveResponse,
  type AssetsListResponse,
  type AssetsSaveInput,
  type AssetView,
  ERROR_CODES,
  type ErrorCode,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "@ucode/contracts";

import { ASSET_MAX_BYTES, COMMAND_NAME_PATTERN, SKILL_NAME_PATTERN } from "../../constants/assets";
import { MARKDOWN_EXTENSION, SKILL_FILENAME } from "../../constants/dirs";
import { builtinPromptCommands } from "../../harness/plugins/builtin";
import {
  agentDirs,
  assertLoadableAgent,
  isUsableAgentSlug,
  parseCustomAgent,
} from "../../harness/setup/agents";
import { AppError } from "../../platform/response";
import {
  type AssetFrontmatterField,
  booleanField,
  buildAssetFile,
  extraFrontmatterLines,
  isSafeExtraLine,
  readAssetFrontmatter,
  stringField,
  stringListField,
} from "./frontmatter";
import {
  type AssetContext,
  type AssetPathInfo,
  type AssetSourceDir,
  assertWritableTarget,
  assetPathInfo,
  assetSourceDirs,
  assetWriteDirOf,
  scopeOf,
} from "./paths";

export type { AssetContext } from "./paths";

/** 内置命令的合成路径前缀：源码常量没有文件，用它把来源标成 `builtin`（与 commands/list 同口径） */
const BUILTIN_PATH_PREFIX = "builtin:";

/** 插件角色的合成路径前缀：插件角色没有可写文件 */
const PLUGIN_PATH_PREFIX = "plugin:";

const fail = (code: ErrorCode, message: string, params?: Record<string, string>): AppError =>
  new AppError(code, message, 400, undefined, params);

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 名称不合规的中文原因；判定本身复用注册表那一份（见 `assertAssetName`），避免两套规则漂移 */
const NAME_REASON: Record<AssetKind, string> = {
  agent: "角色名需为小写字母开头，仅含小写字母、数字与连字符",
  skill: "技能名需为小写字母或数字，单词之间用单个连字符",
  command: "命令名需以小写字母或数字开头，仅含小写字母、数字与连字符",
};

/** 服务端自己序列化的那些键；其余 frontmatter 行原样保留 */
const KEPT_KEYS: Record<AssetKind, readonly string[]> = {
  agent: ["name", "description", "mode", "tools", "model", "thinking", "advertise", "hidden"],
  skill: ["name", "description"],
  command: ["description", "argument-hint"],
};

const assertAssetName = (kind: AssetKind, name: string): void => {
  const valid =
    kind === "agent"
      ? isUsableAgentSlug(name)
      : name.length <= ASSET_NAME_MAX_LENGTH &&
        (kind === "skill" ? SKILL_NAME_PATTERN : COMMAND_NAME_PATTERN).test(name);
  if (!valid) {
    throw fail(ERROR_CODES.assetNameInvalid, `资产名不合法：${name}`, {
      reason: NAME_REASON[kind],
    });
  }
};

/** 目录下的一级 `.md` 文件（不进子目录，与 pi 的命令扫描一致） */
const listMarkdownFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(MARKDOWN_EXTENSION))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

const readContent = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new AppError(ERROR_CODES.pathNotFound, `路径不存在：${path}`, 400, undefined, { path });
  }
};

const requireAsset = (ctx: AssetContext, kind: AssetKind, path: string): AssetPathInfo => {
  const info = assetPathInfo(ctx, kind, path);
  if (!info) {
    throw new AppError(ERROR_CODES.pathNotFound, `路径不存在：${path}`, 400, undefined, { path });
  }
  return info;
};

const viewOf = (
  kind: AssetKind,
  name: string,
  label: string,
  description: string,
  dir: AssetSourceDir,
  path: string,
  owner: string | undefined,
): AssetView => ({
  kind,
  name,
  label,
  description,
  source: dir.source,
  editable: dir.scope !== undefined,
  ...(dir.scope ? { scope: dir.scope } : {}),
  path,
  active: owner === undefined,
  ...(owner ? { overriddenBy: owner } : {}),
});

type Scan = { views: AssetView[]; errors: AssetError[] };

/** 角色：按目录链顺序扫 `*.md`，同名只第一条生效；插件角色并入只读段 */
const scanAgents = (ctx: AssetContext): Scan => {
  const views: AssetView[] = [];
  const errors: AssetError[] = [];
  const owner = new Map<string, string>();

  for (const { dir, source } of agentDirs({
    cwd: ctx.cwd,
    appHome: ctx.appHome,
    userHome: ctx.userHome,
  })) {
    const asDir: AssetSourceDir = { kind: "agent", dir, source, scope: scopeOf(source) };
    for (const file of listMarkdownFiles(dir)) {
      const name = file.slice(0, -MARKDOWN_EXTENSION.length);
      const path = join(dir, file);
      try {
        // 与装配同一套判定：同名主模式、超大文件、frontmatter 非法都在这里现形
        const parsed = assertLoadableAgent(name, readFileSync(path, "utf8"));
        const current = owner.get(name);
        if (!current) owner.set(name, path);
        views.push(
          viewOf(
            "agent",
            name,
            parsed.profile.label,
            parsed.profile.description,
            asDir,
            path,
            current,
          ),
        );
      } catch (error) {
        errors.push({ kind: "agent", name, path, reason: reasonOf(error) });
      }
    }
  }

  for (const agent of ctx.pluginAgents ?? []) {
    views.push({
      kind: "agent",
      name: agent.slug,
      label: agent.label,
      description: agent.description,
      source: "plugin",
      editable: false,
      path: `${PLUGIN_PATH_PREFIX}${agent.slug}`,
      active: true,
    });
  }
  return { views, errors };
};

/**
 * 技能：只认 `<目录>/<name>/SKILL.md`。缺 `description` 的条目 pi 会整条丢弃，
 * 所以这里同样不计入列表、只进 `errors`——列表里列出的就是会话里真的能用的。
 */
const scanSkills = (dirs: readonly AssetSourceDir[]): Scan => {
  const views: AssetView[] = [];
  const errors: AssetError[] = [];
  const owner = new Map<string, string>();

  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir.dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }
    for (const skillDir of entries) {
      const path = join(dir.dir, skillDir, SKILL_FILENAME);
      if (!existsSync(path)) continue;
      try {
        const { fields } = readAssetFrontmatter(readContent(path));
        const name = stringField(fields, "name") ?? skillDir;
        const description = stringField(fields, "description");
        if (!description) throw new Error("缺少 description（pi 会丢弃没有说明的技能）");
        const current = owner.get(name);
        if (!current) owner.set(name, path);
        views.push(viewOf("skill", name, name, description, dir, path, current));
      } catch (error) {
        errors.push({ kind: "skill", name: skillDir, path, reason: reasonOf(error) });
      }
    }
  }
  return { views, errors };
};

/** 正文首个非空行的截断（与 pi 对缺 description 的命令取说明的口径一致） */
const firstLineOf = (body: string): string => {
  const line =
    body
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item !== "") ?? "";
  return line.length > 60 ? `${line.slice(0, 60)}...` : line;
};

/** 命令：按目录顺序扫一级 `*.md`，同名只第一条生效；内置命令补空缺并标 `builtin` */
const scanCommands = (dirs: readonly AssetSourceDir[]): Scan => {
  const views: AssetView[] = [];
  const errors: AssetError[] = [];
  const owner = new Map<string, string>();

  for (const dir of dirs) {
    for (const file of listMarkdownFiles(dir.dir)) {
      const name = file.slice(0, -MARKDOWN_EXTENSION.length);
      const path = join(dir.dir, file);
      try {
        const { fields, body } = readAssetFrontmatter(readContent(path));
        const description = stringField(fields, "description") ?? firstLineOf(body);
        const current = owner.get(name);
        if (!current) owner.set(name, path);
        views.push(viewOf("command", name, name, description, dir, path, current));
      } catch (error) {
        errors.push({ kind: "command", name, path, reason: reasonOf(error) });
      }
    }
  }

  for (const command of builtinPromptCommands()) {
    if (owner.has(command.name)) continue;
    views.push({
      kind: "command",
      name: command.name,
      label: command.name,
      description: command.description,
      source: "builtin",
      editable: false,
      path: `${BUILTIN_PATH_PREFIX}${command.name}`,
      active: true,
    });
  }
  return { views, errors };
};

/** 列出三类资产：含只读来源与被同名压住的条目，解析失败的条目收在 `errors` 里 */
export const listAssets = (ctx: AssetContext): AssetsListResponse => {
  const dirs = assetSourceDirs(ctx);
  const agents = scanAgents(ctx);
  const skills = scanSkills(dirs.filter((dir) => dir.kind === "skill"));
  const commands = scanCommands(dirs.filter((dir) => dir.kind === "command"));
  return {
    agents: agents.views,
    skills: skills.views,
    commands: commands.views,
    errors: [...agents.errors, ...skills.errors, ...commands.errors],
  };
};

/** 技能目录内的其余文件（相对路径，`/` 分隔）；删除时会一并删掉，先让用户看清有什么 */
const listSkillFiles = (root: string): string[] => {
  const files: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), relative);
      else files.push(relative);
    }
  };
  try {
    walk(root, "");
  } catch {
    return [];
  }
  return files.filter((file) => file !== SKILL_FILENAME).sort();
};

const thinkingField = (fields: Record<string, unknown>): ThinkingLevel | undefined => {
  const value = stringField(fields, "thinking");
  return value && (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : undefined;
};

const baseDetail = (
  info: AssetPathInfo,
  label: string,
  description: string,
  body: string,
  content: string,
  warnings: string[],
): AssetDetail => ({
  kind: info.kind,
  name: info.name,
  label,
  description,
  source: info.source,
  editable: info.editable,
  ...(info.scope ? { scope: info.scope } : {}),
  path: info.path,
  body,
  extraLines: extraFrontmatterLines(content, KEPT_KEYS[info.kind]),
  warnings,
});

const readAgentDetail = (info: AssetPathInfo, content: string): AssetDetail => {
  const parsed = parseCustomAgent(info.name, content);
  const { fields, body } = readAssetFrontmatter(content);
  const tools = stringListField(fields, "tools");
  const model = stringField(fields, "model");
  const thinking = thinkingField(fields);
  const advertise = booleanField(fields, "advertise");
  const hidden = booleanField(fields, "hidden");
  return {
    ...baseDetail(info, parsed.profile.label, parsed.profile.description, body, content, []),
    mode: parsed.mode,
    ...(tools ? { tools } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(advertise !== undefined ? { advertise } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
  };
};

const readSkillDetail = (info: AssetPathInfo, content: string): AssetDetail => {
  const { fields, body } = readAssetFrontmatter(content);
  const declared = stringField(fields, "name");
  const description = stringField(fields, "description") ?? "";
  const warnings: string[] = [];
  if (declared && declared !== info.name) {
    warnings.push(
      `frontmatter 的 name（${declared}）与目录名不一致：pi 以 name 为准，删除请用目录名`,
    );
  }
  if (!description) warnings.push("缺少 description：pi 会丢弃没有说明的技能");
  return {
    ...baseDetail(info, declared ?? info.name, description, body, content, warnings),
    files: listSkillFiles(dirname(info.path)),
  };
};

const readCommandDetail = (info: AssetPathInfo, content: string): AssetDetail => {
  const { fields, body } = readAssetFrontmatter(content);
  const description = stringField(fields, "description") ?? firstLineOf(body);
  const argumentHint = stringField(fields, "argument-hint");
  const warnings = stringField(fields, "description")
    ? []
    : ["缺 description：菜单与 /help 里的说明会取正文首行"];
  return {
    ...baseDetail(info, info.name, description, body, content, warnings),
    ...(argumentHint ? { argumentHint } : {}),
  };
};

/** 读一条资产的详情：只读来源同样可读（提示词正文与来源一起看） */
export const readAsset = (ctx: AssetContext, kind: AssetKind, path: string): AssetDetail => {
  const info = requireAsset(ctx, kind, path);
  const content = readContent(info.path);
  if (kind === "agent") return readAgentDetail(info, content);
  if (kind === "skill") return readSkillDetail(info, content);
  return readCommandDetail(info, content);
};

/** 目标文件路径：角色与命令是 `<目录>/<名字>.md`，技能是 `<目录>/<名字>/SKILL.md` */
const targetPathOf = (kind: AssetKind, root: string, name: string): string =>
  kind === "skill" ? join(root, name, SKILL_FILENAME) : join(root, `${name}${MARKDOWN_EXTENSION}`);

const fieldsOf = (input: AssetsSaveInput): AssetFrontmatterField[] => {
  const needDescription = (kind: AssetKind): string => {
    if (!input.description) {
      throw fail(
        ERROR_CODES.assetContentInvalid,
        `资产内容校验失败：${kind === "agent" ? "角色" : "技能"}必须有 description`,
        { reason: "description 必填（模型按它挑选，缺了整条不会被装载）" },
      );
    }
    return input.description;
  };

  if (input.kind === "agent") {
    const fields: AssetFrontmatterField[] = [
      ["name", input.label ?? input.name],
      ["description", needDescription("agent")],
    ];
    if (input.mode) fields.push(["mode", input.mode]);
    if (input.tools) fields.push(["tools", input.tools]);
    if (input.model) fields.push(["model", input.model]);
    if (input.thinking) fields.push(["thinking", input.thinking]);
    if (input.advertise !== undefined) fields.push(["advertise", input.advertise]);
    if (input.hidden !== undefined) fields.push(["hidden", input.hidden]);
    return fields;
  }

  if (input.kind === "skill") {
    return [
      ["name", input.name],
      ["description", needDescription("skill")],
    ];
  }

  const fields: AssetFrontmatterField[] = [];
  if (input.description) fields.push(["description", input.description]);
  if (input.argumentHint) fields.push(["argument-hint", input.argumentHint]);
  return fields;
};

/** 写入前与运行时同一套校验：写出去的文件必须能被装载，否则用户的改动会静默消失 */
const verifySaved = (input: AssetsSaveInput, content: string): void => {
  try {
    if (input.kind === "agent") {
      parseCustomAgent(input.name, content);
      return;
    }
    const { fields } = readAssetFrontmatter(content);
    if (input.kind === "skill" && !stringField(fields, "description")) {
      throw new Error("description 必填，缺了 pi 会整条丢弃");
    }
  } catch (error) {
    const reason = reasonOf(error);
    throw fail(ERROR_CODES.assetContentInvalid, `资产内容校验失败：${reason}`, { reason });
  }
};

/** 临时文件 + rename：避免读到半截内容 */
const writeAtomic = (target: string, content: string): void => {
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, content, "utf8");
    renameSync(temp, target);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
};

/** 新建或覆盖一条资产：落点由 kind + scope 决定，内容先过校验再写盘 */
export const saveAsset = (ctx: AssetContext, input: AssetsSaveInput): AssetSaveResponse => {
  assertAssetName(input.kind, input.name);
  const root = assetWriteDirOf(ctx, input.kind, input.scope);
  const target = targetPathOf(input.kind, root, input.name);
  assertWritableTarget(root, target);

  const extraLines = input.extraLines ?? [];
  if (!extraLines.every(isSafeExtraLine)) {
    throw fail(ERROR_CODES.assetContentInvalid, "资产内容校验失败：额外的 frontmatter 行不合法", {
      reason: "额外的 frontmatter 行必须是单行，且不能含 `---`",
    });
  }

  const content = buildAssetFile({ fields: fieldsOf(input), extraLines, body: input.body });
  if (Buffer.byteLength(content, "utf8") > ASSET_MAX_BYTES) {
    throw fail(
      ERROR_CODES.payloadTooLarge,
      `资产文件超过上限（${Math.floor(ASSET_MAX_BYTES / 1024)}KB）`,
    );
  }
  verifySaved(input, content);

  const created = !existsSync(target);
  const parent = dirname(target);
  // 新建技能的目录位置可能被同名文件占住：那会让 mkdir 抛成 500，这里先给带路径的 400
  if (existsSync(parent) && !statSync(parent).isDirectory()) {
    throw fail(ERROR_CODES.pathExists, `同名文件占住了目录位置：${parent}`, { path: parent });
  }
  mkdirSync(parent, { recursive: true });
  writeAtomic(target, content);
  return { kind: input.kind, name: input.name, path: target, created };
};

/** 删除一条资产：技能连目录一起删（目录里的引用文件、脚本随之消失），只读来源拒绝 */
export const deleteAsset = (
  ctx: AssetContext,
  kind: AssetKind,
  path: string,
): AssetDeleteResponse => {
  const info = requireAsset(ctx, kind, path);
  if (!info.editable) {
    throw fail(ERROR_CODES.assetReadOnly, `该来源的资产不可编辑：${info.path}`, {
      path: info.path,
    });
  }

  if (kind === "skill") {
    const dir = dirname(info.path);
    if (!existsSync(dir)) return { kind, name: info.name, path: info.path, removed: false };
    assertWritableTarget(info.dir, dir);
    rmSync(dir, { recursive: true, force: true });
    return { kind, name: info.name, path: info.path, removed: true };
  }

  if (!existsSync(info.path)) return { kind, name: info.name, path: info.path, removed: false };
  rmSync(info.path, { force: true });
  return { kind, name: info.name, path: info.path, removed: true };
};
