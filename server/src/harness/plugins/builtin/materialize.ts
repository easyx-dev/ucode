/**
 * 内置资产的物化：把需要磁盘真身的技能写到 `$APP_HOME/app/builtin/`，并记一份状态清单。
 *
 * 三条硬要求（见 `plans/plugins.md` 第七章）：
 * - **幂等**：内容相同不写盘（判据是内容比较，不是时间戳）；
 * - **完整性**：声明了必需文件却缺失时**拒绝物化**，保留上一版目录并出诊断——宁可用旧的，也不要半个技能；
 * - **不做哈希目录名**：技能命中记录里存的是绝对路径，路径一变记录就对不上。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { BUILTIN_DIRNAME, SKILL_FILENAME, SKILLS_DIRNAME } from "../../../constants/dirs";
import { type BuiltinAsset, resolveBuiltinAssets } from "./index";

/** 物化状态清单文件名（位于内置资产目录下） */
export const BUILTIN_MANIFEST_FILENAME = "manifest.json";

/** 一条物化记录：内容哈希用于判断「要不要重写」，来源用于排查「这份是谁给的」 */
export type BuiltinMaterializedAsset = {
  id: string;
  kind: "skill";
  version: string;
  /** 该资产全部文件的内容哈希（按路径排序后拼接） */
  sha256: string;
  /** `packaged` = 随包；云端下发时会记成中继标识 */
  origin: string;
  updatedAt: string;
};

export type BuiltinMaterializeResult = {
  /** 物化后的技能父目录：装配层按它注入 loader */
  skillsDir: string;
  /** 本次实际写入的文件数；幂等时是 0 */
  written: number;
  /** 逐条诊断：缺件、写盘失败等；不改服务可用性 */
  diagnostics: string[];
};

/** 读已有的状态清单；读不出来（首次运行、坏 JSON）就当没有 */
const readManifest = (path: string): BuiltinMaterializedAsset[] => {
  const content = readIfExists(path);
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as { assets?: BuiltinMaterializedAsset[] };
    return Array.isArray(parsed.assets) ? parsed.assets : [];
  } catch {
    return [];
  }
};

/**
 * 内容没变就沿用上一次的 `updatedAt`：否则每次启动都会因为时间戳不同而重写清单，
 * 「幂等」这条要求就无从验证。
 */
const withPreviousTimestamps = (
  records: readonly BuiltinMaterializedAsset[],
  previous: readonly BuiltinMaterializedAsset[],
): BuiltinMaterializedAsset[] =>
  records.map((record) => {
    const match = previous.find(
      (item) =>
        item.id === record.id &&
        item.kind === record.kind &&
        item.version === record.version &&
        item.sha256 === record.sha256 &&
        item.origin === record.origin,
    );
    return match ? { ...record, updatedAt: match.updatedAt } : record;
  });

/** 内容哈希：路径排序后逐个拼接，路径或内容任一变化都会变 */
export const hashBuiltinFiles = (files: Record<string, string>): string => {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(files[path] ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
};

const readIfExists = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** 写文件，内容相同就跳过；返回是否真的写了 */
const writeIfChanged = (path: string, content: string, diagnostics: string[]): boolean => {
  if (readIfExists(path) === content) return false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return true;
  } catch (error) {
    diagnostics.push(
      `${path}：写不进去（${error instanceof Error ? error.message : String(error)}）`,
    );
    return false;
  }
};

/** 物化一个技能：必需文件齐全才写；返回记录（缺件时为 null） */
const materializeSkill = (
  asset: Extract<BuiltinAsset, { kind: "skill" }>,
  skillsDir: string,
  diagnostics: string[],
  now: string,
): { record: BuiltinMaterializedAsset; written: number } | null => {
  const missing = asset.requiredFiles.filter((path) => asset.files[path] === undefined);
  if (missing.length > 0) {
    diagnostics.push(`技能 ${asset.id}：缺少必需文件 ${missing.join(" / ")}，保留上一版`);
    return null;
  }

  const skillDir = join(skillsDir, asset.id);
  let written = 0;
  for (const [relative, content] of Object.entries(asset.files)) {
    if (writeIfChanged(join(skillDir, relative), content, diagnostics)) written += 1;
  }

  return {
    record: {
      id: asset.id,
      kind: "skill",
      version: asset.version,
      sha256: hashBuiltinFiles(asset.files),
      origin: "packaged",
      updatedAt: now,
    },
    written,
  };
};

/**
 * 物化内置技能。相位上早于第一次会话装配与 `/` 菜单列举，
 * 所以服务启动时同步跑一次即可；失败只记诊断，不让服务起不来。
 */
export const materializeBuiltinAssets = (input: {
  builtinDir: string;
  assets?: readonly BuiltinAsset[];
  now?: string;
}): BuiltinMaterializeResult => {
  const skillsDir = join(input.builtinDir, SKILLS_DIRNAME);
  const diagnostics: string[] = [];
  const skills = (input.assets ?? resolveBuiltinAssets()).filter(
    (asset): asset is Extract<BuiltinAsset, { kind: "skill" }> => asset.kind === "skill",
  );
  const now = input.now ?? new Date().toISOString();

  let written = 0;
  const records: BuiltinMaterializedAsset[] = [];
  for (const skill of skills) {
    const result = materializeSkill(skill, skillsDir, diagnostics, now);
    if (!result) continue;
    written += result.written;
    records.push(result.record);
  }

  const manifestPath = join(input.builtinDir, BUILTIN_MANIFEST_FILENAME);
  const manifest = JSON.stringify(
    { version: 1, assets: withPreviousTimestamps(records, readManifest(manifestPath)) },
    null,
    2,
  );
  if (writeIfChanged(manifestPath, `${manifest}\n`, diagnostics)) written += 1;

  // 一个技能都没有时也要建出目录：装配层按它注入 loader，目录不存在会被当成「没有内置技能」
  if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });

  return { skillsDir, written, diagnostics };
};
