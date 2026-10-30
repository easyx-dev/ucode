/**
 * 内置资产注册表：随包提供的提示词命令与技能，第三方插件共用同一套装载与优先级。
 *
 * 优先级恒为最低（磁盘 / 用户同名者胜出）；`kind` 决定接入方式——`prompt` 走内存合成的
 * `PromptTemplate`，`skill` 必须物化到磁盘（pi 的 `Skill` 只有文件路径，模型靠 `read` 取正文）。
 *
 * **云端替换**：给了 `builtinDir` 时，按本地状态清单把「已生效的云端记录」对应的随包资产剔掉——
 * 云端那份已经物化在装配扫描的目录里（`builtin/skills`、`builtin/prompts`），随包版本只该当兜底，
 * 不该在每次启动时把那几个文件再写回随包内容（见 `cloud.ts` 与 plans/hub.md「内置资产云同步」）。
 */
import { activeCloudRecords, readBuiltinManifest } from "./manifest";
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

/** 读取入参：不给 `builtinDir` 就是纯随包集合（不碰磁盘） */
export type ResolveBuiltinAssetsInput = {
  /** 内置资产目录（`env.builtinDir`）：给它才会按云端记录做替换 */
  builtinDir?: string;
};

/**
 * 随包集合去掉被云端接管的那些。清单读不出来（首次运行 / 损坏）时视为没有云端记录，
 * 只在内存里过滤，不写盘——写盘归物化与云同步各自负责。
 */
export const resolveBuiltinAssets = (
  input: ResolveBuiltinAssetsInput = {},
): readonly BuiltinAsset[] => {
  if (!input.builtinDir) return PACKAGED_BUILTIN_ASSETS;

  const overridden = new Set(
    activeCloudRecords(readBuiltinManifest(input.builtinDir)).map(
      (record) => `${record.kind}:${record.id}`,
    ),
  );
  if (overridden.size === 0) return PACKAGED_BUILTIN_ASSETS;

  const kept = PACKAGED_BUILTIN_ASSETS.filter(
    (asset) => !overridden.has(`${asset.kind}:${asset.id}`),
  );
  return kept.length === PACKAGED_BUILTIN_ASSETS.length ? PACKAGED_BUILTIN_ASSETS : kept;
};

/** 内置提示词命令：给装配层的 `promptsOverride` 用，顺序即同名优先级（这里只有内置一档） */
export const builtinPromptCommands = (
  assets: readonly BuiltinAsset[] = resolveBuiltinAssets(),
): BuiltinPromptCommand[] =>
  assets.filter((asset) => asset.kind === "prompt").map((asset) => asset.command);
