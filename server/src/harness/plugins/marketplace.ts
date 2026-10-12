/**
 * 市场清单（`marketplace.json`）的读取：本地目录市场与后续的 url 市场共用同一份解析。
 *
 * 宽松解析：条目级错误只跳过该条目并出诊断，清单整体坏了才抛 `marketplace_invalid`——
 * 与插件清单同一口径。条目的来源解析（相对路径 / github / npm）属于包拉取那一步。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ERROR_CODES, type PluginDiagnosticView } from "@ucode/contracts";
import { z } from "zod";

import {
  PLUGIN_COMPAT_MANIFEST_DIRNAMES,
  PLUGIN_MANIFEST_DIRNAME,
  PLUGIN_MARKETPLACE_FILENAME,
} from "../../constants/dirs";
import { AppError } from "../../platform/response";
import { isRecord } from "../../utils/object";
import { describeError, diagnostic } from "./diagnostic";
import type { PluginSourceSpec } from "./state";

/** 市场清单里的一个条目的来源：相对路径（相对市场根）或显式来源 */
export type MarketplaceEntrySource =
  | { kind: "relative"; path: string }
  | { kind: "explicit"; source: PluginSourceSpec };

/** 市场清单里的一个条目：名称 / 说明 / 版本 + 可安装的来源 */
export type MarketplaceCatalogEntry = {
  name: string;
  description: string;
  version: string;
  /** 来源解析不出来（格式不认识、url 市场里的相对路径）时为 undefined：能看不能一键装 */
  source?: MarketplaceEntrySource;
};

export type MarketplaceCatalog = {
  /** 清单自报的市场名；缺省回落登记时用的名字 */
  name: string;
  entries: MarketplaceCatalogEntry[];
  diagnostics: PluginDiagnosticView[];
};

const catalogSchema = z.object({
  name: z.string().optional(),
  plugins: z.array(z.unknown()).default([]),
});

const entrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional(),
  source: z.unknown().optional(),
});

/** 条目的 `source`：字符串按相对路径（`./x` / `x`），对象按显式来源解析 */
const parseEntrySource = (raw: unknown): MarketplaceEntrySource | undefined => {
  if (typeof raw === "string") {
    const path = raw.trim();
    if (!path) return undefined;
    // 带协议的字符串不是相对路径（Claude 的市场里也有 `github:owner/repo` 这类简写）
    if (/^[a-z]+:/i.test(path) && !path.startsWith("./") && !path.startsWith("../")) {
      return undefined;
    }
    return { kind: "relative", path };
  }
  if (!isRecord(raw)) return undefined;

  const kind = typeof raw.source === "string" ? raw.source : "";
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  switch (kind) {
    case "directory":
      return text(raw.path)
        ? { kind: "explicit", source: { source: "directory", path: text(raw.path) as string } }
        : undefined;
    case "url":
      return text(raw.url)
        ? { kind: "explicit", source: { source: "url", url: text(raw.url) as string } }
        : undefined;
    case "npm":
      return text(raw.package)
        ? { kind: "explicit", source: { source: "npm", package: text(raw.package) as string } }
        : undefined;
    case "github":
      return text(raw.repo)
        ? {
            kind: "explicit",
            source: {
              source: "github",
              repo: text(raw.repo) as string,
              ...(text(raw.path) ? { path: text(raw.path) as string } : {}),
              ...(text(raw.ref) ? { ref: text(raw.ref) as string } : {}),
            },
          }
        : undefined;
    case "git":
      return text(raw.url)
        ? {
            kind: "explicit",
            source: {
              source: "git",
              url: text(raw.url) as string,
              ...(text(raw.path) ? { path: text(raw.path) as string } : {}),
              ...(text(raw.ref) ? { ref: text(raw.ref) as string } : {}),
            },
          }
        : undefined;
    default:
      return undefined;
  }
};

/**
 * 解析市场清单内容：url 市场喂响应正文，本地 / git 市场喂文件内容。
 * 形状不对（不是 JSON 对象、`plugins` 不是数组）抛 `marketplace_invalid`；条目级问题只出诊断。
 */
export const parseMarketplaceCatalog = (
  content: string,
  fallbackName: string,
  origin: string,
): MarketplaceCatalog => {
  const invalid = (reason: string, details?: unknown): AppError =>
    new AppError(ERROR_CODES.marketplaceInvalid, `市场清单无效：${origin}`, 400, details, {
      reason,
    });

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw invalid(`读不出来（${describeError(error)}）`);
  }
  if (!isRecord(raw)) throw invalid("顶层不是对象");

  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) throw invalid("plugins 必须是数组", parsed.error.issues);

  const entries: MarketplaceCatalogEntry[] = [];
  const diagnostics: PluginDiagnosticView[] = [];
  parsed.data.plugins.forEach((item, index) => {
    const entry = entrySchema.safeParse(item);
    if (!entry.success) {
      diagnostics.push(diagnostic("error", "manifest", `第 ${index + 1} 个条目缺少 name，已跳过`));
      return;
    }
    const source = parseEntrySource(entry.data.source);
    entries.push({
      name: entry.data.name,
      description: entry.data.description?.trim() || "",
      version: entry.data.version?.trim() || "0.0.0",
      ...(source ? { source } : {}),
    });
  });

  return { name: parsed.data.name?.trim() || fallbackName, entries, diagnostics };
};

/**
 * 市场清单文件的位置：与插件清单同一套三档识别（`.<slug>-plugin` → `.zcode-plugin` → `.claude-plugin`），
 * 都没有再看仓根——Claude 官方市场仓就把清单放在 `.claude-plugin/marketplace.json`。
 */
export const findMarketplaceFile = (marketDir: string): string => {
  for (const dirname of [PLUGIN_MANIFEST_DIRNAME, ...PLUGIN_COMPAT_MANIFEST_DIRNAMES]) {
    const file = join(marketDir, dirname, PLUGIN_MARKETPLACE_FILENAME);
    if (existsSync(file)) return file;
  }
  return join(marketDir, PLUGIN_MARKETPLACE_FILENAME);
};

/** 读本地目录市场的清单；文件缺失或形状不对都抛 `marketplace_invalid` */
export const readMarketplaceCatalog = (
  marketDir: string,
  fallbackName: string,
): MarketplaceCatalog => {
  const file = findMarketplaceFile(marketDir);
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    throw new AppError(
      ERROR_CODES.marketplaceInvalid,
      `市场清单无效：${file}`,
      400,
      describeError(error),
      { reason: `读不出来（${describeError(error)}）` },
    );
  }
  return parseMarketplaceCatalog(content, fallbackName, file);
};
