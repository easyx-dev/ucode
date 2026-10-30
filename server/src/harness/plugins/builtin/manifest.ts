/**
 * 内置资产的本地状态清单：`$APP_HOME/app/builtin/manifest.json`。
 *
 * 随包物化与云端下发共用这一份——「这份内容是谁给的、什么版本、生效没生效」都记在这里，
 * 读它才能判断某个 id 要不要再拉一次（按 id + 版本比对），也才能让随包物化给云端内容让位。
 *
 * 记的是**状态**而不是内容：真身在 `skills/` 与 `prompts/` 下，清单只做索引与判重。
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/** 状态清单文件名（位于内置资产目录下） */
export const BUILTIN_MANIFEST_FILENAME = "manifest.json";

/** 内置资产类型：v1 只有技能目录与提示词命令两种（都可直接生效） */
export type BuiltinAssetKind = "skill" | "prompt";
/** 内容来源：随包发布，或云端下发 */
export type BuiltinAssetOrigin = "packaged" | "cloud";

/** 一条资产记录 */
export type BuiltinAssetRecord = {
  id: string;
  /** 资产类型：`skill` / `prompt` 是 v1 会生效的两种（见 cloud.ts 的可生效范围），其余类型只登记不生效 */
  kind: string;
  version: string;
  /** 全部文件按路径排序后的内容哈希；路径或内容任一变化都会变 */
  sha256: string;
  origin: BuiltinAssetOrigin;
  /** 是否声明了可执行内容（云端资产的清单字段；随包恒为 false） */
  executable: boolean;
  /** 是否已进生效路径（技能目录 / 提示词目录）；含可执行内容的云端资产只落盘，这里为 false */
  active: boolean;
  /** 云端下发时刻（ISO）；随包资产没有 */
  fetchedAt?: string;
  updatedAt: string;
};

export type BuiltinManifest = {
  version: 1;
  assets: BuiltinAssetRecord[];
};

/** 读文件；读不出来（首次运行、坏 JSON、权限不足）就当没有 */
const readTextIfExists = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** 资产内容哈希：按路径排序后逐段拼 `路径\0内容\0`，路径或内容任一变化都会变 */
export const hashBuiltinAssetFiles = (
  files: readonly { path: string; bytes: Uint8Array }[],
): string => {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
};

/**
 * 写文件，内容相同就跳过；返回是否真的写了。
 * 写不进去抛错，由调用方转成诊断——物化与下发对「写不动了」的处理口径不同，不在这一层吞掉。
 */
export const writeFileIfChanged = (path: string, content: string | Uint8Array): boolean => {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  try {
    if (readFileSync(path).equals(bytes)) return false;
  } catch {
    // 读不到（文件不存在 / 读不动）就照常写
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return true;
};

/** 读状态清单；文件缺失或结构认不出来都当空清单（内容没了，旧记录留着也没意义） */
export const readBuiltinManifest = (builtinDir: string): BuiltinManifest => {
  const content = readTextIfExists(join(builtinDir, BUILTIN_MANIFEST_FILENAME));
  if (!content) return { version: 1, assets: [] };
  try {
    const parsed = JSON.parse(content) as { assets?: unknown };
    if (!Array.isArray(parsed.assets)) return { version: 1, assets: [] };
    return { version: 1, assets: dedupeRecords(parsed.assets.filter(isBuiltinAssetRecord)) };
  } catch {
    return { version: 1, assets: [] };
  }
};

/**
 * 同一个 `kind + id` 只留一条（靠后的胜）：清单是「当前是什么」的快照，
 * 云端接管某个随包资产时两条记录同时存在就自相矛盾了（正常写入路径由 upsert 保证，这里兜手工编辑）。
 */
const dedupeRecords = (records: readonly BuiltinAssetRecord[]): BuiltinAssetRecord[] => {
  const byKey = new Map<string, BuiltinAssetRecord>();
  for (const record of records) byKey.set(`${record.kind}:${record.id}`, record);
  return [...byKey.values()];
};

/** 逐条校验：清单是本进程写的，但用户可能手改；形状不符的条目直接丢掉 */
const KIND_PATTERN = /^[a-z][a-z0-9-]*$/;

const isBuiltinAssetRecord = (value: unknown): value is BuiltinAssetRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.kind === "string" &&
    KIND_PATTERN.test(record.kind) &&
    typeof record.version === "string" &&
    typeof record.sha256 === "string" &&
    (record.origin === "packaged" || record.origin === "cloud") &&
    typeof record.executable === "boolean" &&
    typeof record.active === "boolean" &&
    typeof record.updatedAt === "string"
  );
};

/** 写状态清单（`updatedAt` 由调用方给，记录里已带时间戳） */
export const writeBuiltinManifest = (builtinDir: string, manifest: BuiltinManifest): void => {
  mkdirSync(builtinDir, { recursive: true });
  writeFileSync(
    join(builtinDir, BUILTIN_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
};

/**
 * 合并记录：同一 `kind + id` 换掉旧记录，其余原样保留。
 * 保留是关键——随包物化只知道自己那几条，云端下发的记录不归它管，不能被它冲掉（反之亦然）。
 */
export const upsertBuiltinRecords = (
  manifest: BuiltinManifest,
  records: readonly BuiltinAssetRecord[],
): BuiltinManifest => {
  const replaced = new Set(records.map((record) => `${record.kind}:${record.id}`));
  const kept = manifest.assets.filter((record) => !replaced.has(`${record.kind}:${record.id}`));
  return { version: 1, assets: [...kept, ...records] };
};

/** 已生效的云端记录：随包物化据此让位（同名技能 / 命令交给云端那份） */
export const activeCloudRecords = (manifest: BuiltinManifest): BuiltinAssetRecord[] =>
  manifest.assets.filter((record) => record.origin === "cloud" && record.active);
