import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { getBrand } from "@ucode/branding";
import { DATA_FORMAT_VERSION, servicePaths } from "../../paths.ts";
import { writeFileAtomic } from "../../storage/index.ts";
import { REDACTED, redact } from "./redact.ts";
import { collectUsageStats, summarizeUsage, type UsageSummary } from "./usage.ts";

/**
 * 支持包导出（F-5.7）：把"排查问题需要的东西"打成一个**可分享的单文件**。
 *
 * 三条取舍：
 * 1. **单文件 gzip JSON** 而不是 zip：Node 没有内建 zip，为它引依赖不值得；gzip 内建、
 *    任何机器都能解，`.json.gz` 也仍然是一个可以附在 issue 里的文件；
 * 2. **导出前脱敏**（见 `redact.ts`）：这是要发出去的东西，密钥不能在里面；
 * 3. **只带"说明问题"的部分**：清单 + 用量 + 会话索引 + 配置（脱敏）+ 日志尾部；
 *    不带会话正文（那是用户的内容，除非他自己导出）。
 */

export type SupportBundleOptions = {
  dataDir: string;
  /** 日志尾部最多带多少字节/文件。 */
  maxLogBytesPerFile?: number;
  /** 最多带几个日志文件。 */
  maxLogFiles?: number;
};

export type SupportBundle = {
  file: string;
  bytes: number;
  /** 包里带了哪些部分（如实列出，用户知道自己在分享什么）。 */
  included: string[];
  usage: UsageSummary;
};

const DEFAULT_MAX_LOG_BYTES = 100_000;
const DEFAULT_MAX_LOG_FILES = 5;

export async function exportSupportBundle(options: SupportBundleOptions): Promise<SupportBundle> {
  const paths = servicePaths(options.dataDir);
  const usage = await collectUsageStats(options.dataDir);

  const included = ["manifest", "usage", "sessions-index", "config", "logs"];
  const manifest = {
    product: getBrand().productName,
    exportedAt: new Date().toISOString(),
    dataFormatVersion: DATA_FORMAT_VERSION,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    redaction: `键名含 key/secret/token/password/credential 等的字段已替换为 ${REDACTED}`,
  };

  const config = {
    models: redact(await readJson(paths.models)),
    settings: redact(await readJson(paths.settings)),
    auth: redact(await readJson(paths.auth)),
    hooks: redact(await readJson(paths.hooks)),
    ssh: redact(await readJson(paths.ssh)),
  };

  const logs = await readLogTails(paths.runtimeDir, {
    maxBytes: options.maxLogBytesPerFile ?? DEFAULT_MAX_LOG_BYTES,
    maxFiles: options.maxLogFiles ?? DEFAULT_MAX_LOG_FILES,
  });

  const sessions = await sessionIndex(paths.sessions);

  const bundle = {
    manifest,
    usage: { summary: usage, readable: summarizeUsage(usage) },
    sessions,
    config,
    logs,
  };

  const json = JSON.stringify(bundle, null, 2);
  const gzipped = gzipSync(Buffer.from(json, "utf8"));
  const exportsDir = join(options.dataDir, "exports");
  await mkdir(exportsDir, { recursive: true, mode: 0o700 });
  const file = join(
    exportsDir,
    `support-${new Date().toISOString().replace(/[:.]/gu, "-")}.json.gz`,
  );
  await writeFileAtomic(file, gzipped, { mode: 0o600 });

  return { file, bytes: gzipped.byteLength, included, usage };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** 会话索引（不算正文）：每条会话的 id / 目录 / 条数 / 首条时间。 */
async function sessionIndex(
  sessionsRoot: string,
): Promise<{ count: number; buckets: { bucket: string; sessions: number }[] }> {
  const buckets: { bucket: string; sessions: number }[] = [];
  let bucketsNames: string[] = [];
  try {
    bucketsNames = await readdir(sessionsRoot);
  } catch {
    return { count: 0, buckets };
  }
  let count = 0;
  for (const bucket of bucketsNames) {
    let files: string[] = [];
    try {
      files = (await readdir(join(sessionsRoot, bucket))).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    count += files.length;
    buckets.push({ bucket, sessions: files.length });
  }
  return { count, buckets };
}

/** 日志尾部（脱敏后的文本）。 */
async function readLogTails(
  logsDir: string,
  options: { maxBytes: number; maxFiles: number },
): Promise<{ name: string; tail: string }[]> {
  let names: string[] = [];
  try {
    names = await readdir(logsDir);
  } catch {
    return [];
  }
  const out: { name: string; tail: string }[] = [];
  // 取最近的几个文件（按 mtime 倒序）。
  const withTime = await Promise.all(
    names.map(async (name) => {
      try {
        return { name, mtime: (await stat(join(logsDir, name))).mtimeMs };
      } catch {
        return { name, mtime: 0 };
      }
    }),
  );
  withTime.sort((a, b) => b.mtime - a.mtime);
  for (const { name } of withTime.slice(0, options.maxFiles)) {
    try {
      const content = await readFile(join(logsDir, name), "utf8");
      out.push({ name, tail: redactLogText(content.slice(-options.maxBytes)) });
    } catch {
      // 单个日志读不了不该让导出失败
    }
  }
  return out;
}

/** 日志文本里的密钥：日志是自由文本，只能按"像密钥的样子"抹。 */
export function redactLogText(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, REDACTED)
    .replace(/\bgh[pous]_[A-Za-z0-9]{16,}/gu, REDACTED)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/giu, `$1${REDACTED}`)
    .replace(
      /((?:api[-_]?key|token|password|secret)"?\s*[:=]\s*"?)[^"\s,}]{6,}/giu,
      `$1${REDACTED}`,
    );
}
