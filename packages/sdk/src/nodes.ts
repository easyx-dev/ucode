import type { Transport, TrustLevel } from "@ucode/protocol";

/**
 * 节点注册表（F-6.3）：控制层**记住并接入多个服务层节点**。
 *
 * 一台机器可以有多个服务层实例（本机多个、或直连远端），控制层要能记住"我连过哪些"。
 * 注册表是**控制层的数据**（跟设备/浏览器走），因此这里只提供纯逻辑与序列化，
 * 具体持久化交给宿主（CLI 写文件、Web 写 localStorage）——sdk 不碰 `window` 也不碰磁盘。
 *
 * ## 关于节点身份认证（F-6.4）
 * spec 里节点认证**只服务 uhub 通路**（`TOKEN` 由 uhub 签发、绑定层校验）。本项目按目标
 * 把 uhub 排除在外，因此这里只保留**凭据引用**（`credentialRef`：指向 OS 凭据存储里的名字，
 * F-5.4），不实现 uhub 的令牌签发与校验——那部分留空并在此标注，避免假装做了。
 */

export type NodeEndpoint =
  | { kind: "http"; baseUrl: string }
  | { kind: "rpc"; socketPath?: string; host?: string; port?: number };

export type NodeRecord = {
  /** 稳定标识：由 endpoint 派生（同一地址不会重复登记）。 */
  id: string;
  /** 引用名（命令里用它，如 `local`、`lab`）。 */
  name: string;
  displayName?: string;
  endpoint: NodeEndpoint;
  /** 凭据引用：指向 OS 凭据存储里的名字，**注册表里不放凭据本身**。 */
  credentialRef?: string;
  /** 最近一次连接观察到的信任级别（来自 welcome，仅供显示与排错）。 */
  lastTrustLevel?: TrustLevel;
  lastConnectedAt?: string;
  /** uhub 签发的节点令牌（F-6.4）——**uhub 在范围外，这里始终为空**。 */
  uhubToken?: never;
};

export type NodeInput = {
  name: string;
  endpoint: NodeEndpoint;
  displayName?: string;
  credentialRef?: string;
};

export const NODE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

export function endpointKey(endpoint: NodeEndpoint): string {
  if (endpoint.kind === "http") return `http:${endpoint.baseUrl.replace(/\/+$/u, "")}`;
  if (endpoint.socketPath !== undefined) return `rpc:unix:${endpoint.socketPath}`;
  return `rpc:tcp:${endpoint.host ?? "127.0.0.1"}:${endpoint.port ?? 0}`;
}

export function normalizeNode(input: NodeInput): NodeRecord | string {
  const name = input.name.trim();
  if (!NODE_NAME_PATTERN.test(name)) return `非法的节点名 ${input.name}（只允许字母/数字/._-）。`;
  const endpoint = input.endpoint;
  if (endpoint.kind === "http") {
    if (!/^https?:\/\//iu.test(endpoint.baseUrl))
      return `http 端点必须是 http(s) 地址：${endpoint.baseUrl}`;
  } else {
    if (endpoint.socketPath === undefined && endpoint.port === undefined) {
      return "rpc 端点需要 socketPath 或 port 之一。";
    }
  }
  const record: NodeRecord = { id: endpointKey(endpoint), name, endpoint };
  if (input.displayName !== undefined && input.displayName !== "")
    record.displayName = input.displayName;
  if (input.credentialRef !== undefined && input.credentialRef !== "") {
    record.credentialRef = input.credentialRef;
  }
  return record;
}

export class NodeRegistry {
  #nodes = new Map<string, NodeRecord>();

  constructor(nodes: readonly NodeRecord[] = []) {
    for (const node of nodes) this.#nodes.set(node.id, node);
  }

  list(): NodeRecord[] {
    return [...this.#nodes.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(nameOrId: string): NodeRecord | undefined {
    return (
      this.#nodes.get(nameOrId) ??
      this.list().find((node) => node.name === nameOrId || node.displayName === nameOrId)
    );
  }

  /** 登记（同名或同端点视为同一条，就地更新——避免同一台机器出现两条记录）。 */
  add(input: NodeInput): NodeRecord {
    const normalized = normalizeNode(input);
    if (typeof normalized === "string") throw new Error(normalized);
    for (const [id, node] of this.#nodes) {
      if (node.name === normalized.name && id !== normalized.id) this.#nodes.delete(id);
    }
    this.#nodes.set(normalized.id, normalized);
    return normalized;
  }

  remove(nameOrId: string): boolean {
    const node = this.get(nameOrId);
    if (node === undefined) return false;
    return this.#nodes.delete(node.id);
  }

  /** 记录一次成功连接（信任级别与时间，供显示/排错）。 */
  markConnected(nameOrId: string, info: { trustLevel: TrustLevel; at?: Date }): boolean {
    const node = this.get(nameOrId);
    if (node === undefined) return false;
    this.#nodes.set(node.id, {
      ...node,
      lastTrustLevel: info.trustLevel,
      lastConnectedAt: (info.at ?? new Date()).toISOString(),
    });
    return true;
  }

  toJSON(): { version: number; nodes: NodeRecord[] } {
    return { version: 1, nodes: this.list() };
  }

  static fromJSON(raw: unknown): NodeRegistry {
    if (typeof raw !== "object" || raw === null) return new NodeRegistry();
    const nodes = (raw as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodes)) return new NodeRegistry();
    const valid: NodeRecord[] = [];
    for (const item of nodes) {
      if (typeof item !== "object" || item === null) continue;
      const value = item as Record<string, unknown>;
      if (
        typeof value.name !== "string" ||
        typeof value.endpoint !== "object" ||
        value.endpoint === null
      ) {
        continue;
      }
      const normalized = normalizeNode({
        name: value.name,
        endpoint: value.endpoint as NodeEndpoint,
        ...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}),
        ...(typeof value.credentialRef === "string" ? { credentialRef: value.credentialRef } : {}),
      });
      if (typeof normalized === "string") continue;
      valid.push({
        ...normalized,
        ...(typeof value.lastTrustLevel === "string"
          ? { lastTrustLevel: value.lastTrustLevel as TrustLevel }
          : {}),
        ...(typeof value.lastConnectedAt === "string"
          ? { lastConnectedAt: value.lastConnectedAt }
          : {}),
      });
    }
    return new NodeRegistry(valid);
  }
}

export function describeNode(node: NodeRecord): string {
  const target =
    node.endpoint.kind === "http"
      ? node.endpoint.baseUrl
      : (node.endpoint.socketPath ??
        `${node.endpoint.host ?? "127.0.0.1"}:${node.endpoint.port ?? 0}`);
  const parts = [`${node.name} → ${target}`];
  if (node.displayName !== undefined) parts.push(`(${node.displayName})`);
  if (node.credentialRef !== undefined) parts.push(`凭据引用 ${node.credentialRef}`);
  if (node.lastTrustLevel !== undefined) parts.push(`上次信任级别 ${node.lastTrustLevel}`);
  return parts.join(" ");
}
