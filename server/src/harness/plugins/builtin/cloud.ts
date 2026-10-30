/**
 * 内置资产的云端下发：从中继拉清单、按 id + 版本比对、逐文件校验后物化到磁盘。
 *
 * 四条边界（方案见 plans/hub.md「内置资产云同步」）：
 * - **主动出站**：拉取由本侧发起；中继不可达只是「拿不到更新」，任何失败都只记中文诊断，
 *   不抛到启动路径（调用方 fire-and-forget，物化与 `/` 菜单列举都不等它）；
 * - **只认配置里的中继域**：清单给的下载路径按相对 URL 解析，绝对地址 / 换域一律拒绝；
 * - **逐文件 sha256 校验**：以清单登记值为准，内容包自报的哈希只用来提示不一致；不匹配即整条丢弃；
 * - **可执行内容不生效**：含 hooks / bin / MCP / 扩展的资产只落盘到 `quarantine/`，记诊断等显式信任。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  BUILTIN_QUARANTINE_DIRNAME,
  PROMPTS_DIRNAME,
  SKILLS_DIRNAME,
} from "../../../constants/dirs";
import {
  HUB_BUILTIN_ASSET_PATH_PREFIX,
  HUB_BUILTIN_MANIFEST_PATH,
  HUB_BUILTIN_TIMEOUT_MS,
} from "../../../constants/hub";
import {
  type BuiltinAssetKind,
  type BuiltinAssetRecord,
  hashBuiltinAssetFiles,
  readBuiltinManifest,
  upsertBuiltinRecords,
  writeBuiltinManifest,
  writeFileIfChanged,
} from "./manifest";

/** 清单里的单个文件登记项 */
export type CloudBuiltinFile = {
  path: string;
  sha256: string;
  size: number;
};

/** 清单里的一项资产（字段口径见 hub/docs/builtin-assets.md） */
export type CloudBuiltinAsset = {
  id: string;
  kind: string;
  version: string;
  executable: boolean;
  /** 下载路径：必须是本中继下的相对路径 */
  path: string;
  size: number;
  files: CloudBuiltinFile[];
};

export type CloudBuiltinManifest = {
  version: number;
  updatedAt: string;
  assets: CloudBuiltinAsset[];
};

/** 下载并校验过的单个文件：哈希按本侧算出的字节重算 */
export type DownloadedBuiltinFile = {
  path: string;
  bytes: Buffer;
  sha256: string;
};

/** 是否激活该资产 */
export type BuiltinActivationDecision = { active: true } | { active: false; reason: string };

/** 可生效的资产类型：v1 只有技能（`SKILL.md` 目录）与提示词（单文件命令），都是纯文本 / 声明式内容 */
const ACTIVATABLE_KINDS: readonly BuiltinAssetKind[] = ["skill", "prompt"];

/** 资产 id / 版本与中继侧同一套字符集（同时是目录名，挡掉路径穿越） */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 暂存目录名（与生效目录同在内置资产目录下，但不在装配扫描的 `skills/` `prompts/` 里） */
const STAGING_DIRNAME = ".staging";

/** 换版时上一版在暂存区的备份后缀（rename 失败时靠它把旧版放回去） */
const PREVIOUS_DIR_SUFFIX = "previous";

/** 类型名只作展示与判据，不接受任意字符 */
const KIND_PATTERN = /^[a-z][a-z0-9-]*$/;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const ACTIVATION_REASONS = {
  executable: "含可执行内容（hooks / bin / MCP / 扩展），需显式信任后才会生效",
} as const;

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const textOf = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const reasonOf = (error: unknown): string =>
  error instanceof Error
    ? error.name === "TimeoutError"
      ? "请求超时"
      : error.message
    : String(error);

/** 文件内容的 sha256（十六进制小写） */
const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** 相对路径：不接受绝对路径、反斜杠与 `..`/`.` 段（内容包里的路径会拼进磁盘路径） */
export const isSafeRelativePath = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");

/**
 * 生效边界：纯文本与声明式内容直接生效，可执行内容与未知类型只落盘。
 * **不因来源是运营方就放宽**——下发通道的凭证只证明「是本中继发的」，不证明内容可信。
 */
export const decideBuiltinActivation = (asset: CloudBuiltinAsset): BuiltinActivationDecision => {
  if (!(ACTIVATABLE_KINDS as readonly string[]).includes(asset.kind)) {
    return {
      active: false,
      reason: `资产类型 ${asset.kind} 不在可生效范围内（v1 只生效技能与提示词）`,
    };
  }
  if (asset.executable) return { active: false, reason: ACTIVATION_REASONS.executable };
  return { active: true };
};

/** 清单条目解析：结构不对的条目丢掉并出诊断，不影响其余条目，也不让整次同步失败 */
const toCloudAsset = (value: unknown): { asset: CloudBuiltinAsset } | { problem: string } => {
  const raw = recordOf(value);
  const id = textOf(raw?.id);
  const kind = textOf(raw?.kind);
  const version = textOf(raw?.version);
  const path = textOf(raw?.path);
  if (!id || !SEGMENT_PATTERN.test(id)) return { problem: "清单里有一条资产缺少合法 id" };
  if (!kind || !KIND_PATTERN.test(kind)) return { problem: `资产 ${id} 的类型不合法` };
  if (!version || !SEGMENT_PATTERN.test(version)) return { problem: `资产 ${id} 的版本号不合法` };
  if (!path?.startsWith(HUB_BUILTIN_ASSET_PATH_PREFIX)) {
    return { problem: `资产 ${id} 的下载路径不在 ${HUB_BUILTIN_ASSET_PATH_PREFIX} 下` };
  }

  const files: CloudBuiltinFile[] = [];
  for (const item of Array.isArray(raw?.files) ? raw.files : []) {
    const entry = recordOf(item);
    const filePath = textOf(entry?.path);
    const sha256 = textOf(entry?.sha256);
    const size = entry?.size;
    if (!filePath || !isSafeRelativePath(filePath)) {
      return { problem: `资产 ${id} 的文件路径不合法` };
    }
    if (!sha256 || !SHA256_PATTERN.test(sha256))
      return { problem: `资产 ${id} 的 ${filePath} 缺少 sha256` };
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
      return { problem: `资产 ${id} 的 ${filePath} 体积不合法` };
    }
    files.push({ path: filePath, sha256, size });
  }
  if (files.length === 0) return { problem: `资产 ${id} 没有任何文件` };

  // 缺少可执行标记时按「含可执行内容」处理：宁可不生效，也不默认信任
  const executable = raw?.executable !== false;
  return {
    asset: {
      id,
      kind,
      version,
      executable,
      path,
      size: typeof raw?.size === "number" ? raw.size : 0,
      files,
    },
  };
};

/** 解析中继清单：逐条容错，返回可用条目与丢弃原因 */
export const parseCloudManifest = (
  payload: unknown,
): { manifest: CloudBuiltinManifest; problems: string[] } => {
  const root = recordOf(payload);
  const rawAssets = root?.assets;
  const manifest: CloudBuiltinManifest = {
    version: typeof root?.version === "number" ? root.version : 1,
    updatedAt: textOf(root?.updatedAt) ?? "",
    assets: [],
  };
  if (!Array.isArray(rawAssets)) return { manifest, problems: ["清单结构认不出来（缺少 assets）"] };

  const problems: string[] = [];
  for (const item of rawAssets) {
    const parsed = toCloudAsset(item);
    if ("problem" in parsed) problems.push(parsed.problem);
    else manifest.assets.push(parsed.asset);
  }
  return { manifest, problems };
};

/** 同步计划：哪些要下载、哪些本地已最新 */
export type BuiltinSyncPlan = {
  downloads: CloudBuiltinAsset[];
  skipped: string[];
};

/** 比对口径：本地记录里同 `kind + id` 且版本一致即跳过（内容按版本寻址，版本相同就不重下） */
export const planBuiltinSync = (
  local: readonly BuiltinAssetRecord[],
  remote: readonly CloudBuiltinAsset[],
): BuiltinSyncPlan => {
  const localVersions = new Map(
    local.map((record) => [`${record.kind}:${record.id}`, record.version]),
  );
  const plan: BuiltinSyncPlan = { downloads: [], skipped: [] };
  for (const asset of remote) {
    if (localVersions.get(`${asset.kind}:${asset.id}`) === asset.version) {
      plan.skipped.push(asset.id);
      continue;
    }
    plan.downloads.push(asset);
  }
  return plan;
};

/** 逐文件校验：路径集合、体积与 sha256 都要对上；不匹配的逐条说明 */
export const verifyBuiltinAssetFiles = (
  expected: readonly CloudBuiltinFile[],
  actual: readonly DownloadedBuiltinFile[],
): string[] => {
  const problems: string[] = [];
  const expectedPaths = new Set(expected.map((file) => file.path));
  for (const file of actual) {
    if (!expectedPaths.has(file.path)) problems.push(`内容包里多出清单没登记的 ${file.path}`);
  }

  const actualByPath = new Map(actual.map((file) => [file.path, file]));
  for (const file of expected) {
    const got = actualByPath.get(file.path);
    if (!got) {
      problems.push(`缺少文件 ${file.path}`);
      continue;
    }
    if (got.bytes.byteLength !== file.size) {
      problems.push(`${file.path} 体积不符（清单 ${file.size}，实际 ${got.bytes.byteLength}）`);
    }
    if (got.sha256 !== file.sha256) {
      problems.push(`${file.path} 的 sha256 不符（清单 ${file.sha256}，实际 ${got.sha256}）`);
    }
  }
  return problems;
};

/** 内容包解析结果 */
export type ParsedBuiltinBundle = {
  /** 内容包自报的 id / 版本，用于与请求的资产核对 */
  id: string | null;
  version: string | null;
  files: DownloadedBuiltinFile[];
  problems: string[];
};

/**
 * 解析内容包：编码只认 `utf8` / `base64`，哈希按本侧算出的字节重算。
 * 内容包自报的 sha256 只作提示（与清单不符时记一条诊断），校验以清单为准。
 */
export const parseBuiltinBundle = (payload: unknown): ParsedBuiltinBundle => {
  const root = recordOf(payload);
  const parsed: ParsedBuiltinBundle = {
    id: textOf(root?.id),
    version: textOf(root?.version),
    files: [],
    problems: [],
  };
  if (!Array.isArray(root?.files)) {
    parsed.problems.push("内容包结构认不出来（缺少 files）");
    return parsed;
  }

  for (const item of root.files) {
    const entry = recordOf(item);
    const path = textOf(entry?.path);
    const content = typeof entry?.content === "string" ? entry.content : null;
    if (!path || !isSafeRelativePath(path) || content === null) {
      parsed.problems.push("内容包里有路径或正文不合法的文件");
      continue;
    }
    if (entry?.encoding !== "utf8" && entry?.encoding !== "base64") {
      parsed.problems.push(`${path} 的编码方式不在支持范围内`);
      continue;
    }

    const bytes = Buffer.from(content, entry.encoding === "utf8" ? "utf8" : "base64");
    const sha256 = sha256Of(bytes);
    if (sha256 !== textOf(entry?.sha256)) {
      parsed.problems.push(`${path} 的 sha256 与其自报值不符`);
    }
    parsed.files.push({ path, bytes, sha256 });
  }
  return parsed;
};

/**
 * 下载地址解析：只接受配置里的中继域；清单给绝对地址或换域的一律拒绝。
 * 按拼接而不是 `new URL(path, base)`：`/` 开头的路径会按 origin 解析，把中继地址里的路径前缀丢掉。
 */
export const resolveBuiltinDownloadUrl = (hubUrl: string, assetPath: string): string | null => {
  if (!assetPath.startsWith(HUB_BUILTIN_ASSET_PATH_PREFIX)) return null;
  let base: URL;
  try {
    base = new URL(hubUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;
  let target: URL;
  try {
    target = new URL(`${hubUrl.replace(/\/+$/, "")}${assetPath}`);
  } catch {
    return null;
  }
  return target.origin === base.origin ? target.toString() : null;
};

/** 拉取入参：中继配置由服务层从 `service.json` 读出后注入（harness 不读服务层配置） */
export type BuiltinCloudSyncInput = {
  /** 中继地址（`relay.url`）；为空＝未接入中继，直接不拉 */
  hubUrl: string | null;
  /** 设备令牌（`relay.deviceToken`）；为空＝本机还没登记设备，直接不拉 */
  deviceToken: string | null;
  /** 内置资产目录（`env.builtinDir`） */
  builtinDir: string;
  /** 记录用时间戳，缺省取当前时刻 */
  now?: string;
  /** 注入请求实现（单测用，不连网）；缺省走全局 fetch */
  fetchJson?: (url: URL, token: string) => Promise<unknown>;
  /** 诊断出口（中文）：只报警不改变流程，缺省丢弃 */
  onDiagnostic?: (message: string) => void;
};

/** 一次云同步的结果：数量与名单都留着，供日志与后续设置页展示 */
export type BuiltinCloudSyncResult = {
  /** 是否真的向中继拉过（未接入中继时为 false，不算失败） */
  fetched: boolean;
  /** 已下载且已生效的资产 id */
  applied: string[];
  /** 已下载但未生效的资产 id（含可执行内容或类型不生效） */
  quarantined: string[];
  /** 本地已是最新而跳过的资产 id */
  skipped: string[];
  /** 逐条中文诊断（网络失败、校验不过、拒绝生效都在这里） */
  diagnostics: string[];
};

/** 请求中继并解析响应体；非 2xx 与结构不对都抛错，由调用方转成诊断 */
const fetchHubJson = async (url: URL, token: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(HUB_BUILTIN_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = detail.slice(0, 200).trim();
    throw new Error(`中继回了 ${response.status}${message ? `（${message}）` : ""}`);
  }
  return response.json();
};

/** 物化目标：技能是目录，提示词是单文件；都不在生效路径时返回 null */
const activationTarget = (
  builtinDir: string,
  asset: CloudBuiltinAsset,
): { dir: string; expected: string } | null => {
  if (asset.kind === "skill") {
    return { dir: join(builtinDir, SKILLS_DIRNAME, asset.id), expected: "SKILL.md" };
  }
  if (asset.kind === "prompt")
    return { dir: join(builtinDir, PROMPTS_DIRNAME), expected: `${asset.id}.md` };
  return null;
};

/**
 * 把暂存目录换成就位的技能目录。上一版先挪到暂存区的备份名下，新版就位失败就把它放回去：
 * 直接「先删后 rename」的话，rename 一失败就新旧两版都没了。
 */
const replaceSkillDir = (input: { staging: string; target: string; backup: string }): void => {
  const { staging, target, backup } = input;
  rmSync(backup, { recursive: true, force: true });
  const hasPrevious = existsSync(target);
  if (hasPrevious) renameSync(target, backup);
  try {
    renameSync(staging, target);
  } catch (error) {
    if (hasPrevious) renameSync(backup, target);
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
};

/**
 * 写进生效路径。技能先写进暂存目录再整体换掉目标目录：换版本时旧版多出来的文件不会残留
 * （暂存目录放在 `$APP_HOME/app/builtin/.staging`，不在装配扫描的 `skills/` 下，写一半也不会被当成技能）。
 */
const activateFiles = (input: {
  builtinDir: string;
  asset: CloudBuiltinAsset;
  files: readonly DownloadedBuiltinFile[];
  diagnostics: string[];
}): boolean => {
  const { builtinDir, asset, files, diagnostics } = input;
  const target = activationTarget(builtinDir, asset);
  if (!target) {
    diagnostics.push(`资产 ${asset.id}：类型 ${asset.kind} 没有生效路径`);
    return false;
  }
  const expected = files.find((file) => file.path === target.expected);
  if (!expected) {
    diagnostics.push(`资产 ${asset.id}：缺少必需文件 ${target.expected}，保留上一版`);
    return false;
  }

  if (asset.kind === "prompt") {
    writeFileIfChanged(join(target.dir, target.expected), expected.bytes);
    return true;
  }

  const stagingRoot = join(builtinDir, STAGING_DIRNAME);
  const staging = join(stagingRoot, asset.id);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const file of files) writeFileIfChanged(join(staging, file.path), file.bytes);
  mkdirSync(join(builtinDir, SKILLS_DIRNAME), { recursive: true });
  replaceSkillDir({
    staging,
    target: target.dir,
    backup: join(stagingRoot, `${asset.id}.${PREVIOUS_DIR_SUFFIX}`),
  });
  return true;
};

/** 拒绝生效的资产只落盘备查：`quarantine/<id>/<version>/`，不进装配扫描的目录 */
const quarantineFiles = (input: {
  builtinDir: string;
  asset: CloudBuiltinAsset;
  files: readonly DownloadedBuiltinFile[];
}): void => {
  const dir = join(
    input.builtinDir,
    BUILTIN_QUARANTINE_DIRNAME,
    input.asset.id,
    input.asset.version,
  );
  rmSync(dir, { recursive: true, force: true });
  for (const file of input.files) writeFileIfChanged(join(dir, file.path), file.bytes);
};

/** 下载一项资产：解析内容包 → 逐文件校验 → 物化 / 隔离；返回 null 表示这一项没落地 */
const downloadCloudAsset = async (input: {
  hubUrl: string;
  token: string;
  request: (url: URL, token: string) => Promise<unknown>;
  builtinDir: string;
  asset: CloudBuiltinAsset;
  now: string;
  diagnostics: string[];
}): Promise<BuiltinAssetRecord | null> => {
  const { asset, diagnostics } = input;
  const url = resolveBuiltinDownloadUrl(input.hubUrl, asset.path);
  if (!url) {
    diagnostics.push(`资产 ${asset.id}：下载路径不在配置的中继域内，已丢弃`);
    return null;
  }

  let payload: unknown;
  try {
    payload = await input.request(new URL(url), input.token);
  } catch (error) {
    diagnostics.push(`资产 ${asset.id}：下载失败（${reasonOf(error)}）`);
    return null;
  }

  const bundle = parseBuiltinBundle(payload);
  for (const problem of bundle.problems) diagnostics.push(`资产 ${asset.id}：${problem}`);
  if (bundle.id !== asset.id || bundle.version !== asset.version) {
    diagnostics.push(
      `资产 ${asset.id}：内容包自报的 ${bundle.id ?? "?"}@${bundle.version ?? "?"} 与请求不符，已丢弃`,
    );
    return null;
  }

  const mismatches = verifyBuiltinAssetFiles(asset.files, bundle.files);
  if (mismatches.length > 0) {
    for (const problem of mismatches) diagnostics.push(`资产 ${asset.id}：${problem}`);
    diagnostics.push(`资产 ${asset.id}：校验不通过，整条丢弃`);
    return null;
  }

  const decision = decideBuiltinActivation(asset);
  if (!decision.active) {
    quarantineFiles({ builtinDir: input.builtinDir, asset, files: bundle.files });
    diagnostics.push(`资产 ${asset.id}：已下载但未生效（${decision.reason}）`);
  } else if (
    !activateFiles({ builtinDir: input.builtinDir, asset, files: bundle.files, diagnostics })
  ) {
    return null;
  }

  return {
    id: asset.id,
    kind: asset.kind,
    version: asset.version,
    sha256: hashBuiltinAssetFiles(bundle.files),
    origin: "cloud",
    executable: asset.executable,
    active: decision.active,
    fetchedAt: input.now,
    updatedAt: input.now,
  };
};

/**
 * 拉一次云端清单并按需下载。**不抛异常**：任何失败都只落在 `diagnostics` 里，
 * 由调用方决定记日志还是展示（启动路径上只记 warn，不影响装配）。
 */
export const pullCloudBuiltinAssets = async (
  input: BuiltinCloudSyncInput,
): Promise<BuiltinCloudSyncResult> => {
  const result: BuiltinCloudSyncResult = {
    fetched: false,
    applied: [],
    quarantined: [],
    skipped: [],
    diagnostics: [],
  };
  const report = (message: string): void => {
    result.diagnostics.push(message);
    input.onDiagnostic?.(message);
  };

  const hubUrl = input.hubUrl?.trim();
  const token = input.deviceToken?.trim();
  // 未接入中继（没地址或没登记设备）不是失败：什么也不做，也不报诊断
  if (!hubUrl || !token) return result;

  try {
    let base: URL;
    try {
      base = new URL(hubUrl);
    } catch {
      report(`内置资产云同步：中继地址不可用（${hubUrl}）`);
      return result;
    }
    if (base.protocol !== "http:" && base.protocol !== "https:") {
      report(`内置资产云同步：中继地址不是 http(s)（${hubUrl}）`);
      return result;
    }

    result.fetched = true;
    const request = input.fetchJson ?? fetchHubJson;
    const local = readBuiltinManifest(input.builtinDir);
    const { manifest, problems } = parseCloudManifest(
      // 与下载地址同一口径：保留中继地址里的路径前缀
      await request(new URL(`${hubUrl.replace(/\/+$/, "")}${HUB_BUILTIN_MANIFEST_PATH}`), token),
    );
    for (const problem of problems) report(`内置资产云同步：${problem}`);
    if (manifest.assets.length === 0) return result;

    const plan = planBuiltinSync(local.assets, manifest.assets);
    result.skipped.push(...plan.skipped);
    if (plan.downloads.length === 0) return result;

    const now = input.now ?? new Date().toISOString();
    const records: BuiltinAssetRecord[] = [];
    for (const asset of plan.downloads) {
      // 单项失败不影响其余项（含写盘失败）：能拿到的更新就落地，拿不到的下次再拉
      let record: BuiltinAssetRecord | null = null;
      try {
        record = await downloadCloudAsset({
          hubUrl,
          token,
          request,
          builtinDir: input.builtinDir,
          asset,
          now,
          diagnostics: result.diagnostics,
        });
      } catch (error) {
        result.diagnostics.push(`资产 ${asset.id}：落盘失败（${reasonOf(error)}）`);
      }
      if (!record) continue;
      records.push(record);
      if (record.active) result.applied.push(asset.id);
      else result.quarantined.push(asset.id);
    }

    if (records.length > 0) {
      writeBuiltinManifest(input.builtinDir, upsertBuiltinRecords(local, records));
    }
  } catch (error) {
    report(`内置资产云同步失败（${reasonOf(error)}）`);
  }
  return result;
};
