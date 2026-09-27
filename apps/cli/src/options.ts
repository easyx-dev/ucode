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
  { name: "service start", summary: "启动常驻服务（唯一后端；壳会自动拉起它）" },
  { name: "service status", summary: "查看服务状态（pid / 端点 / 数据层 / 会话数）" },
  { name: "service stop", summary: "停止服务（优雅退出：释放租约并清注册）" },
  { name: "service logs", summary: "查看服务日志（-f 持续跟踪）" },
  { name: "trust", summary: "项目信任：`trust` 授信当前目录（也可 `--list` / `--revoke`）" },
  { name: "web", summary: "打开 Web 壳（确保服务在跑，然后把浏览器指向它）" },
  { name: "tui", summary: "启动内置 TUI 壳（默认连本机服务，没有就拉起）" },
  { name: "provider add", summary: "写入模型供应商配置（本地权威，写进数据层的 models.json）" },
  { name: "provider list", summary: "列出当前可用的模型" },
  { name: "node add", summary: "登记一个服务层节点（本机或直连远端；凭据放 OS 凭据存储）" },
  { name: "node list", summary: "列出已登记的节点" },
  { name: "node remove", summary: "移除一个已登记的节点" },
] as const;

export type ParsedCli =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "service.start"; options: ServiceStartOptions }
  | { kind: "service.status"; options: GlobalOptions }
  | { kind: "service.stop"; options: GlobalOptions }
  | { kind: "service.logs"; options: ServiceLogsOptions }
  | { kind: "trust"; options: TrustOptions }
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

/** 自主级别：新建会话时的默认值。 */
export type AutonomyOption = "confirm" | "auto-edit" | "plan" | "full-access";

export type WebOptions = GlobalOptions & {
  host: string;
  port: number;
  allowNonLoopback: boolean;
  /** 前台跑服务（旧行为：阻塞，Ctrl-C 即停）；默认是"确保服务在跑"后返回。 */
  foreground: boolean;
  /** 顺带在浏览器里打开。 */
  open: boolean;
};

export type ServiceStartOptions = GlobalOptions & {
  /** 前台运行；省略则把自己 detach 出去常驻。 */
  foreground: boolean;
  /** 嵌入式形态：只服务 stdio（父进程 spawn 的壳用），不注册端点、不占实例锁。 */
  stdio: boolean;
  host: string;
  port?: number;
  allowNonLoopback: boolean;
  /** 只留 unix socket，不监听环回 HTTP（不需要浏览器时更干净）。 */
  noHttp: boolean;
  /** Web 壳产物的显式目录（打包后的桌面壳用它把产物指给服务层）。 */
  webAssets?: string;
  autonomy: AutonomyOption;
};

export type ServiceLogsOptions = GlobalOptions & {
  /** 持续跟踪（Ctrl-C 退出）。 */
  follow: boolean;
};

/** 项目信任：默认列出；给了子命令就授信/撤销（`dir` 省略时用 --cwd）。 */
export type TrustOptions = GlobalOptions & {
  command: "list" | "grant" | "revoke";
  dir?: string;
};

export type TuiOptions = GlobalOptions & {
  /** 连一个已经在跑的服务层/服务；省略则确保本机服务在跑再连它。 */
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

  try {
    if (first === "service") {
      const sub = second;
      if (sub === "start") {
        const parsed = parseArgs({
          args: rest,
          options: {
            ...SHARED_OPTIONS,
            foreground: { type: "boolean", default: false },
            stdio: { type: "boolean", default: false },
            host: { type: "string", default: "127.0.0.1" },
            port: { type: "string" },
            "no-http": { type: "boolean", default: false },
            "web-assets": { type: "string" },
            autonomy: { type: "string", default: "confirm" },
            "allow-non-loopback": { type: "boolean", default: false },
          },
          allowPositionals: false,
        });
        if (parsed.values.help === true) return { kind: "help" };
        const base = resolveDataDir(parsed.values["data-dir"]);
        return {
          kind: "service.start",
          options: {
            ...base,
            cwd: parsed.values.cwd ?? base.cwd,
            foreground: parsed.values.foreground === true || parsed.values.stdio === true,
            stdio: parsed.values.stdio === true,
            host: parsed.values.host,
            ...(parsed.values.port === undefined ? {} : { port: Number(parsed.values.port) }),
            allowNonLoopback: parsed.values["allow-non-loopback"] === true,
            noHttp: parsed.values["no-http"] === true,
            ...(parsed.values["web-assets"] === undefined
              ? {}
              : { webAssets: parsed.values["web-assets"] }),
            autonomy: parsed.values.autonomy as AutonomyOption,
          },
        };
      }
      if (sub === "status" || sub === "stop") {
        const parsed = parseArgs({ args: rest, options: SHARED_OPTIONS, allowPositionals: false });
        if (parsed.values.help === true) return { kind: "help" };
        const options = resolveDataDir(parsed.values["data-dir"]);
        return sub === "status"
          ? { kind: "service.status", options }
          : { kind: "service.stop", options };
      }
      if (sub === "logs") {
        const parsed = parseArgs({
          args: rest,
          options: { ...SHARED_OPTIONS, follow: { type: "boolean", short: "f", default: false } },
          allowPositionals: false,
        });
        if (parsed.values.help === true) return { kind: "help" };
        return {
          kind: "service.logs",
          options: {
            ...resolveDataDir(parsed.values["data-dir"]),
            follow: parsed.values.follow === true,
          },
        };
      }
      return { kind: "error", message: `未知的 service 子命令：「${sub ?? ""}」。`, code: 2 };
    }

    if (first === "web") {
      const parsed = parseArgs({
        args: [second, ...rest].filter((value) => value !== undefined),
        options: {
          ...SHARED_OPTIONS,
          host: { type: "string", default: "127.0.0.1" },
          port: { type: "string", default: "3000" },
          "allow-non-loopback": { type: "boolean", default: false },
          foreground: { type: "boolean", default: false },
          open: { type: "boolean", default: false },
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
          foreground: parsed.values.foreground === true,
          open: parsed.values.open === true,
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

    if (first === "trust") {
      const parsed = parseArgs({
        args: [second, ...rest].filter((value) => value !== undefined),
        options: {
          ...SHARED_OPTIONS,
          revoke: { type: "boolean", default: false },
          list: { type: "boolean", default: false },
        },
        allowPositionals: true,
      });
      if (parsed.values.help === true) return { kind: "help" };
      const base = resolveDataDir(parsed.values["data-dir"]);
      const dir = parsed.positionals[0];
      const command =
        parsed.values.list === true ? "list" : parsed.values.revoke === true ? "revoke" : "grant";
      return {
        kind: "trust",
        options: {
          ...base,
          cwd: parsed.values.cwd ?? base.cwd,
          command,
          ...(dir === undefined ? {} : { dir }),
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
