/**
 * MCP 服务器配置的读写：唯一来源是 `$APP_HOME/harness/mcp.json`（用户级，不做项目级）。
 *
 * 文件沿用 pi 与其他 MCP 客户端共用的 `mcpServers` 形状；本服务只改 `mcpServers` 这一项，
 * 顶层其它键（如 `autoEnableCodemode`）原样保留，避免覆盖用户手写的配置。
 * 读盘失败不抛错——坏配置以 `errors` 回报，设置页与日志都能看到，不拖垮会话装配。
 * 路径参数化（默认 `env.mcpConfigPath`）只为单测能在临时目录里跑。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  LoadedMcpConfig,
  McpServerConfig,
  McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import {
  type McpDeleteResponse,
  type McpListResponse,
  type McpServerView,
  type McpUpsertInput,
  type McpWriteResponse,
  mcpServerSchema,
} from "@ucode/contracts";

import { MCP_CONFIG_FILENAME } from "../../constants";
import { env } from "../../env";
import { logger } from "../../lib/logger";

/** 运行时数据目录下的 MCP 配置文件路径；装配层按会话的 harnessDir 取，避免读到别的目录 */
export const mcpConfigPathOf = (harnessDir: string): string =>
  resolve(harnessDir, MCP_CONFIG_FILENAME);

/** mcp.json 的原始结构：只认 `mcpServers` 与 `autoEnableCodemode`，其余键原样保留 */
type RawMcpFile = Record<string, unknown> & {
  mcpServers?: unknown;
  autoEnableCodemode?: unknown;
};

/**
 * 写盘前读取：文件不存在或无法解析都按空配置处理，让写操作成为坏文件的修复路径
 * （解析失败只记日志）。删除命中与否仍以解析结果为准，不会误删。
 */
const readRawForWrite = (path: string): RawMcpFile => {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as RawMcpFile;
    }
  } catch {
    // 落到下面的空配置分支
  }
  logger.warn({ path }, "MCP 配置文件无法解析，写入将覆盖为新的配置");
  return {};
};

/** 读盘 + 解析，失败以 `errors` 回报而非抛错 */
const parseRawFile = (path: string): { raw: RawMcpFile; errors: string[] } => {
  if (!existsSync(path)) return { raw: {}, errors: [] };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { raw: {}, errors: [`读取 MCP 配置失败：${(error as Error).message}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { raw: {}, errors: ["MCP 配置文件不是合法 JSON"] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { raw: {}, errors: ["MCP 配置文件的顶层必须是对象"] };
  }
  return { raw: parsed as RawMcpFile, errors: [] };
};

const mcpServersOf = (raw: RawMcpFile): Record<string, unknown> => {
  const value = raw.mcpServers;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 校验一条文件条目。文件里没有 `name`（name 是键），补上并给 `type` 补 pi 的默认值 stdio 后再校验。
 * 通过时同时返回归一化后的**原始条目**——装配层要把它整条交给 pi，不能只留下本服务建模的字段。
 */
const validateEntry = (
  name: string,
  entry: unknown,
): { view: McpServerView; raw: Record<string, unknown> } | { error: string } => {
  const record = isRecord(entry) ? entry : {};
  const type = record.type ?? "stdio";
  const parsed = mcpServerSchema.safeParse({ ...record, name, type });
  if (!parsed.success) {
    return { error: `服务器 ${name} 配置不合法：${parsed.error.issues[0]?.message ?? "未知错误"}` };
  }
  return { view: parsed.data, raw: { ...record, type } };
};

/** 设置页用的条目视图：不合法的一条只记错误、不影响其余条目 */
const collectServerViews = (raw: RawMcpFile): { servers: McpServerView[]; errors: string[] } => {
  const servers: McpServerView[] = [];
  const errors: string[] = [];
  for (const [name, entry] of Object.entries(mcpServersOf(raw))) {
    const result = validateEntry(name, entry);
    if ("error" in result) {
      errors.push(result.error);
      continue;
    }
    servers.push(result.view);
  }
  return { servers, errors };
};

/** 契约视图建模的字段：写入时这些以视图为准，其余键（用户手写的高级字段）原样保留 */
const MODELED_KEYS = new Set([
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "enabled",
  "exposure",
  "timeout",
]);

const unmodeledFields = (entry: unknown): Record<string, unknown> =>
  isRecord(entry)
    ? Object.fromEntries(Object.entries(entry).filter(([key]) => !MODELED_KEYS.has(key)))
    : {};

/** 契约视图 → pi 的服务器配置（去掉 name，name 在文件里是键） */
const viewToServerConfig = (view: McpServerView): McpServerConfig => {
  const common = {
    enabled: view.enabled,
    exposure: view.exposure,
    ...(view.timeout === undefined ? {} : { timeout: view.timeout }),
  };
  return view.type === "stdio"
    ? {
        ...common,
        type: "stdio",
        command: view.command,
        ...(view.args ? { args: view.args } : {}),
        ...(view.env ? { env: view.env } : {}),
        ...(view.cwd ? { cwd: view.cwd } : {}),
      }
    : {
        ...common,
        type: "http",
        url: view.url,
        ...(view.headers ? { headers: view.headers } : {}),
      };
};

/** 原子写回：临时文件 + rename，避免写一半被会话装配读到 */
const writeRawFile = (path: string, raw: RawMcpFile): void => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
};

export const readMcpConfig = (path: string = env.mcpConfigPath): McpListResponse => {
  const { raw, errors } = parseRawFile(path);
  const collected = collectServerViews(raw);
  return {
    servers: collected.servers,
    configPath: path,
    errors: [...errors, ...collected.errors],
  };
};

/**
 * 给 pi 的 `createMcpExtension({ loadConfig })`：只认这一份文件，排除项目级 `.pi/mcp.json`。
 * 校验用本服务的子集，但交给 pi 的是**原始条目**——`toolExposure` / `oauth` 等未建模字段
 * 原样透传，避免把它们悄悄丢掉（尤其是 `toolExposure` 的 hidden 语义会被反转）。
 */
export const readMcpConfigForLoader = (path: string = env.mcpConfigPath): LoadedMcpConfig => {
  const { raw, errors } = parseRawFile(path);
  const servers: McpServerEntry[] = [];
  const entryErrors: string[] = [];
  for (const [name, entry] of Object.entries(mcpServersOf(raw))) {
    const result = validateEntry(name, entry);
    if ("error" in result) {
      entryErrors.push(result.error);
      continue;
    }
    servers.push({
      name,
      config: result.raw as unknown as McpServerConfig,
      source: path,
      scope: "global",
    });
  }
  return {
    servers,
    ...(typeof raw.autoEnableCodemode === "boolean"
      ? { autoEnableCodemode: raw.autoEnableCodemode }
      : {}),
    errors: [...errors, ...entryErrors],
  };
};

export const writeMcpServer = (
  input: McpUpsertInput,
  path: string = env.mcpConfigPath,
): McpWriteResponse => {
  const raw = readRawForWrite(path);
  const servers = mcpServersOf(raw);
  const config = {
    // 用户手写、本服务未建模的字段原样保留；建模字段以视图为准
    ...unmodeledFields(servers[input.name]),
    ...viewToServerConfig(input),
  };
  writeRawFile(path, { ...raw, mcpServers: { ...servers, [input.name]: config } });
  return { server: input, configPath: path };
};

export const deleteMcpServer = (
  name: string,
  path: string = env.mcpConfigPath,
): McpDeleteResponse => {
  const raw = readRawForWrite(path);
  const servers = { ...mcpServersOf(raw) };
  if (!(name in servers)) return { removed: false, configPath: path };
  delete servers[name];
  writeRawFile(path, { ...raw, mcpServers: servers });
  return { removed: true, configPath: path };
};
