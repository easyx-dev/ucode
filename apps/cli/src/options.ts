import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { envVar, getBrand } from "@ucode/branding";

/**
 * CLI 参数解析。
 *
 * 两条规矩：
 * 1. **数据层默认目录来自品牌配置**（ADR-023），代码里不出现目录名字面量；
 * 2. **stdout 归协议通道**：stdio 绑定下 stdout 是协议 C 的线，因此所有日志都走 stderr。
 */

export type GlobalOptions = {
  dataDir: string;
  cwd: string;
  /** 显式给出的数据层目录（供提示"来自哪里"用）。 */
  dataDirSource: "flag" | "env" | "default";
};

export const COMMANDS = [
  { name: "core start", summary: "启动核心层（headless，可脱离控制层单独运行）" },
  { name: "web", summary: "启动内置 Web 壳（核心层 + HTTP/SSE + 静态资源，同一端口）" },
  { name: "tui", summary: "启动内置 TUI 壳（复用 sdk；默认自己拉起一个核心层）" },
  { name: "provider add", summary: "写入模型供应商配置（本地权威，写进数据层的 models.json）" },
  { name: "provider list", summary: "列出当前可用的模型" },
  { name: "node add", summary: "登记一个核心层节点（本机或直连远端；凭据放 OS 凭据存储）" },
  { name: "node list", summary: "列出已登记的节点" },
  { name: "node remove", summary: "移除一个已登记的节点" },
] as const;

export type ParsedCli =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "core.start"; options: CoreStartOptions }
  | { kind: "web"; options: WebOptions }
  | { kind: "tui"; options: TuiOptions }
  | { kind: "provider.add"; options: ProviderAddOptions }
  | { kind: "provider.list"; options: { dataDir: string } }
  | { kind: "node.add"; options: NodeAddOptions }
  | { kind: "node.list"; options: { dataDir: string } }
  | { kind: "node.remove"; options: { dataDir: string; name: string } }
  | { kind: "error"; message: string; code: number };

/** 节点登记参数（F-6.3）：http 用 --url，rpc 用 --socket 或 --host/--port。 */
export type NodeAddOptions = GlobalOptions & {
  name: string;
  url?: string;
  socketPath?: string;
  host?: string;
  port?: number;
  displayName?: string;
  credentialRef?: string;
};

export type ProviderAddOptions = GlobalOptions & {
  id: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  api: string;
};

export type BindingName = "stdio" | "rpc" | "http" | "ws";

export type CoreStartOptions = GlobalOptions & {
  binding: BindingName;
  socketPath?: string;
  host: string;
  port?: number;
  /** 启动时就把默认自主级别定下来（新建会话用）。 */
  autonomy: "confirm" | "auto-edit" | "plan" | "full-access";
  /** 显式允许非环回监听（信任级别会降为 untrusted）。 */
  allowNonLoopback: boolean;
};

export type WebOptions = GlobalOptions & {
  host: string;
  port: number;
  allowNonLoopback: boolean;
};

export type TuiOptions = GlobalOptions & {
  /** 连一个已经在跑的核心层；省略则自己 spawn 一个（stdio）。 */
  coreEndpoint?:
    | { kind: "rpc"; socketPath?: string; host?: string; port?: number }
    | { kind: "http"; baseUrl: string };
};

const SHARED_OPTIONS = {
  "data-dir": { type: "string" },
  cwd: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

export function defaultDataDir(): { dataDir: string; source: "env" | "default" } {
  const fromEnv = process.env[envVar("DATA_DIR")];
  if (fromEnv !== undefined && fromEnv !== "") return { dataDir: fromEnv, source: "env" };
  return { dataDir: join(homedir(), getBrand().dataDirName), source: "default" };
}

function resolveDataDir(value: string | undefined): GlobalOptions {
  if (value !== undefined && value !== "") {
    return { dataDir: value, cwd: process.cwd(), dataDirSource: "flag" };
  }
  const fallback = defaultDataDir();
  return { dataDir: fallback.dataDir, cwd: process.cwd(), dataDirSource: fallback.source };
}

export function parseCli(argv: string[]): ParsedCli {
  const [first, second, ...rest] = argv;
  const isCoreStart = first === "core" && second === "start";

  try {
    if (isCoreStart) {
      const parsed = parseArgs({
        args: rest,
        options: {
          ...SHARED_OPTIONS,
          binding: { type: "string", default: "stdio" },
          socket: { type: "string" },
          host: { type: "string", default: "127.0.0.1" },
          port: { type: "string" },
          autonomy: { type: "string", default: "confirm" },
          "allow-non-loopback": { type: "boolean", default: false },
        },
        allowPositionals: true,
      });
      if (parsed.values.help === true) return { kind: "help" };
      if (parsed.values.version === true) return { kind: "version" };
      const binding = parsed.values.binding as BindingName;
      if (!["stdio", "rpc", "http", "ws"].includes(binding)) {
        return { kind: "error", message: `未知的绑定：${binding}`, code: 2 };
      }
      const base = resolveDataDir(parsed.values["data-dir"]);
      return {
        kind: "core.start",
        options: {
          ...base,
          cwd: parsed.values.cwd ?? base.cwd,
          binding,
          ...(parsed.values.socket === undefined ? {} : { socketPath: parsed.values.socket }),
          host: parsed.values.host,
          ...(parsed.values.port === undefined ? {} : { port: Number(parsed.values.port) }),
          autonomy: parsed.values.autonomy as CoreStartOptions["autonomy"],
          allowNonLoopback: parsed.values["allow-non-loopback"] === true,
        },
      };
    }

    if (first === "web") {
      const parsed = parseArgs({
        args: [second, ...rest].filter((value) => value !== undefined),
        options: {
          ...SHARED_OPTIONS,
          host: { type: "string", default: "127.0.0.1" },
          port: { type: "string", default: "3000" },
          "allow-non-loopback": { type: "boolean", default: false },
        },
        allowPositionals: false,
      });
      if (parsed.values.help === true) return { kind: "help" };
      const base = resolveDataDir(parsed.values["data-dir"]);
      return {
        kind: "web",
        options: {
          ...base,
          cwd: parsed.values.cwd ?? base.cwd,
          host: parsed.values.host,
          port: Number(parsed.values.port ?? "3000"),
          allowNonLoopback: parsed.values["allow-non-loopback"] === true,
        },
      };
    }

    if (first === "tui") {
      const parsed = parseArgs({
        args: [second, ...rest].filter((value) => value !== undefined),
        options: {
          ...SHARED_OPTIONS,
          core: { type: "string" },
        },
        allowPositionals: false,
      });
      if (parsed.values.help === true) return { kind: "help" };
      const base = resolveDataDir(parsed.values["data-dir"]);
      const core = parsed.values.core;
      return {
        kind: "tui",
        options: {
          ...base,
          cwd: parsed.values.cwd ?? base.cwd,
          ...(core === undefined ? {} : { coreEndpoint: parseCoreEndpoint(core) }),
        },
      };
    }

    if (first === "provider") {
      const sub = second;
      if (sub === "add") {
        const parsed = parseArgs({
          args: rest,
          options: {
            ...SHARED_OPTIONS,
            id: { type: "string", default: "local" },
            "base-url": { type: "string" },
            model: { type: "string" },
            "api-key": { type: "string" },
            api: { type: "string", default: "openai-completions" },
          },
          allowPositionals: false,
        });
        if (parsed.values.help === true) return { kind: "help" };
        const baseUrl = parsed.values["base-url"];
        const model = parsed.values.model;
        if (baseUrl === undefined || model === undefined) {
          return {
            kind: "error",
            message: "provider add 需要 --base-url 与 --model（可选 --api-key / --id / --api）。",
            code: 2,
          };
        }
        const base = resolveDataDir(parsed.values["data-dir"]);
        return {
          kind: "provider.add",
          options: {
            ...base,
            id: parsed.values.id,
            baseUrl,
            model,
            api: parsed.values.api,
            ...(parsed.values["api-key"] === undefined ? {} : { apiKey: parsed.values["api-key"] }),
          },
        };
      }
      if (sub === "list") {
        const parsed = parseArgs({
          args: rest,
          options: SHARED_OPTIONS,
          allowPositionals: false,
        });
        if (parsed.values.help === true) return { kind: "help" };
        return { kind: "provider.list", options: resolveDataDir(parsed.values["data-dir"]) };
      }
      return { kind: "error", message: `未知的 provider 子命令：「${sub ?? ""}」。`, code: 2 };
    }

    if (first === "node") {
      const sub = second;
      if (sub === "add") {
        const parsed = parseArgs({
          args: rest,
          options: {
            ...SHARED_OPTIONS,
            name: { type: "string" },
            url: { type: "string" },
            socket: { type: "string" },
            host: { type: "string" },
            port: { type: "string" },
            "display-name": { type: "string" },
            "credential-ref": { type: "string" },
          },
          allowPositionals: false,
        });
        if (parsed.values.help === true) return { kind: "help" };
        const name = parsed.values.name;
        const url = parsed.values.url;
        const socketPath = parsed.values.socket;
        const host = parsed.values.host;
        const port = parsed.values.port;
        if (name === undefined) {
          return { kind: "error", message: "node add 需要 --name。", code: 2 };
        }
        if (url === undefined && socketPath === undefined && port === undefined) {
          return {
            kind: "error",
            message: "node add 需要 --url（http 端点）或 --socket / --port（rpc 端点）。",
            code: 2,
          };
        }
        const portNumber = port === undefined ? undefined : Number.parseInt(port, 10);
        if (
          port !== undefined &&
          (Number.isNaN(portNumber as number) || (portNumber as number) <= 0)
        ) {
          return { kind: "error", message: `非法端口：${port}`, code: 2 };
        }
        return {
          kind: "node.add",
          options: {
            ...resolveDataDir(parsed.values["data-dir"]),
            name,
            ...(url === undefined ? {} : { url }),
            ...(socketPath === undefined ? {} : { socketPath }),
            ...(host === undefined ? {} : { host }),
            ...(portNumber === undefined ? {} : { port: portNumber }),
            ...(parsed.values["display-name"] === undefined
              ? {}
              : { displayName: parsed.values["display-name"] }),
            ...(parsed.values["credential-ref"] === undefined
              ? {}
              : { credentialRef: parsed.values["credential-ref"] }),
          },
        };
      }
      if (sub === "list") {
        const parsed = parseArgs({ args: rest, options: SHARED_OPTIONS, allowPositionals: false });
        if (parsed.values.help === true) return { kind: "help" };
        return { kind: "node.list", options: resolveDataDir(parsed.values["data-dir"]) };
      }
      if (sub === "remove") {
        const parsed = parseArgs({
          args: rest,
          options: { ...SHARED_OPTIONS, name: { type: "string" } },
          allowPositionals: false,
        });
        if (parsed.values.help === true) return { kind: "help" };
        if (parsed.values.name === undefined) {
          return { kind: "error", message: "node remove 需要 --name。", code: 2 };
        }
        return {
          kind: "node.remove",
          options: { ...resolveDataDir(parsed.values["data-dir"]), name: parsed.values.name },
        };
      }
      return { kind: "error", message: `未知的 node 子命令：「${sub ?? ""}」。`, code: 2 };
    }

    if (first === undefined || first === "--help" || first === "-h") return { kind: "help" };
    if (first === "--version" || first === "-v") return { kind: "version" };
    return {
      kind: "error",
      message: `未知命令：「${[first, second].filter(Boolean).join(" ")}」。`,
      code: 2,
    };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      code: 2,
    };
  }
}

export function parseCoreEndpoint(
  value: string,
):
  | { kind: "rpc"; socketPath?: string; host?: string; port?: number }
  | { kind: "http"; baseUrl: string } {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return { kind: "http", baseUrl: value.replace(/\/$/, "") };
  }
  if (value.startsWith("unix:")) return { kind: "rpc", socketPath: value.slice(5) };
  const match = /^(?:tcp:\/\/)?([^:]+):(\d+)$/.exec(value);
  if (match !== null) return { kind: "rpc", host: match[1], port: Number(match[2]) };
  return { kind: "rpc", socketPath: value };
}
