import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { envVar, getBrand } from "@ucode/branding";

/**
 * 磁盘布局（服务层唯一的事实来源）。
 *
 * <数据根>/
 * ├── runtime/                活句柄与本次运行的日志：不迁移、不进支持包、可随时删
 * │   ├── service.json          注册表（pid / 端点 / 版本）
 * │   ├── service.lock          实例锁：一个数据根一个服务
 * │   ├── socket.sock           unix socket（路径过长则省略）
 * │   └── service.log           detached 进程的 stdout/stderr
 * └── v1/                     数据格式版本：迁移 = 读旧写新，不原地重写
 *     ├── service/            SQLite 与尚未入库的功能域文件
 *     └── pi/                 pi agent-dir：pi 生态按这些名字认（可用 pi CLI 直接指过来）
 *
 * 划分规则见 docs/02-服务层内部.md：需要查询/事务的结构化状态进 SQLite，
 * 模型要直接读写、pi 生态要识别的资源留在 pi 目录，**密钥永不入库**。
 */

/** 数据格式版本。布局变化时递增：新旧目录并列，迁移是显式拷贝而不是原地重写。 */
export const DATA_FORMAT_VERSION = "v1";

export type ServicePaths = {
  /** 数据根：显式参数、`UCODE_DATA_DIR`、或家目录下的品牌数据目录。 */
  root: string;
  /** 版本目录：一切"数据"都在这里。 */
  dataDir: string;
  /** 服务自己的状态目录。 */
  serviceDir: string;
  /** pi agent-dir。 */
  piDir: string;
  database: string;
  /** 运行时目录：活句柄与本次运行的日志。 */
  runtimeDir: string;
  registry: string;
  lock: string;
  /** unix socket 路径；数据根太深时为 undefined（退回只用环回 HTTP）。 */
  socket: string | undefined;
  log: string;

  // pi 侧：沿用 pi 的目录与文件名，`pi` CLI 指过来即可直接读写
  settings: string;
  models: string;
  auth: string;
  agentsMd: string;
  sessions: string;
  extensions: string;
  skills: string;
  prompts: string;
  themes: string;
  /** 子智能体定义与运行时安装的 pi 包。 */
  agents: string;
  /** 运行期安装的 pi 包（node_modules）。 */
  npm: string;
  /** 项目授信记录：与基座同一份文件、同一套语义。 */
  trust: string;

  // 服务侧：尚未入库的功能域（各自迁进 SQLite 时逐个删除）
  memories: string;
  tasks: string;
  hooks: string;
  wiki: string;
  ssh: string;
  marketplaces: string;
  nodes: string;
  /** MCP 服务器登记（只记怎么启动，不存凭据）。 */
  mcp: string;
  /** 可重建的派生缓存。 */
  cache: string;
};

/** 解析数据根：显式参数 > 环境变量 > 家目录下的品牌数据目录。 */
export function resolveDataRoot(input?: string, cwd: string = process.cwd()): string {
  const explicit = input?.trim();
  if (explicit !== undefined && explicit !== "") return expandPath(explicit, cwd);
  const fromEnv = process.env[envVar("DATA_DIR")];
  if (fromEnv !== undefined && fromEnv !== "") return expandPath(fromEnv, cwd);
  return join(homedir(), getBrand().dataDirName);
}

function expandPath(value: string, cwd: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return resolve(cwd, value);
}

/** unix socket 路径受内核限制（macOS `sun_path` 104 字节）：超了就不给 socket，宁可少一条通路也不要起不来。 */
const MAX_SOCKET_PATH_BYTES = 100;

export function servicePaths(root: string): ServicePaths {
  const absolute = resolve(root);
  const runtimeDir = join(absolute, "runtime");
  const socket = join(runtimeDir, "socket.sock");
  const dataDir = join(absolute, DATA_FORMAT_VERSION);
  const serviceDir = join(dataDir, "service");
  const piDir = join(dataDir, "pi");
  return {
    root: absolute,
    dataDir,
    serviceDir,
    piDir,
    database: join(serviceDir, "service.db"),
    runtimeDir,
    registry: join(runtimeDir, "service.json"),
    lock: join(runtimeDir, "service.lock"),
    socket: Buffer.byteLength(socket, "utf8") <= MAX_SOCKET_PATH_BYTES ? socket : undefined,
    log: join(runtimeDir, "service.log"),

    settings: join(piDir, "settings.json"),
    models: join(piDir, "models.json"),
    auth: join(piDir, "auth.json"),
    agentsMd: join(piDir, "AGENTS.md"),
    sessions: join(piDir, "sessions"),
    extensions: join(piDir, "extensions"),
    skills: join(piDir, "skills"),
    prompts: join(piDir, "prompts"),
    themes: join(piDir, "themes"),
    agents: join(piDir, "agents"),
    npm: join(piDir, "npm"),
    trust: join(piDir, "trust.json"),

    memories: join(serviceDir, "memories"),
    tasks: join(serviceDir, "tasks"),
    hooks: join(serviceDir, "hooks.json"),
    wiki: join(serviceDir, "wiki"),
    ssh: join(serviceDir, "ssh.json"),
    marketplaces: join(serviceDir, "marketplaces.json"),
    nodes: join(serviceDir, "nodes.json"),
    mcp: join(serviceDir, "mcp.json"),
    cache: join(serviceDir, "cache"),
  };
}

/** 开服务时要预先建好的目录（其余按需创建）。 */
export function managedDirs(paths: ServicePaths): string[] {
  return [paths.dataDir, paths.serviceDir, paths.piDir, paths.sessions, paths.cache];
}
