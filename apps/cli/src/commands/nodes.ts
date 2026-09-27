import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeNode, type NodeEndpoint, type NodeRecord, NodeRegistry } from "@ucode/sdk";

/**
 * 节点注册表（F-6.3）：CLI 侧的持久化与展示。
 *
 * 注册表是**控制层的数据**（跟着设备走），所以文件放在数据层目录旁边即可——
 * 本机 CLI 与核心层同机，这样查/改都近。sdk 只提供纯逻辑与序列化，磁盘由这里负责
 * （sdk 不碰 node:fs，浏览器里才用 localStorage）。
 */

export function nodesFileFor(dataDir: string): string {
  return join(dataDir, "nodes.json");
}

function loadRegistry(dataDir: string): NodeRegistry {
  try {
    return NodeRegistry.fromJSON(JSON.parse(readFileSync(nodesFileFor(dataDir), "utf8")));
  } catch {
    return new NodeRegistry();
  }
}

function saveRegistry(dataDir: string, registry: NodeRegistry): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(nodesFileFor(dataDir), JSON.stringify(registry.toJSON(), null, 2), { mode: 0o600 });
}

export type NodeAddOptions = {
  dataDir: string;
  name: string;
  url?: string;
  socketPath?: string;
  host?: string;
  port?: number;
  displayName?: string;
  credentialRef?: string;
};

export function runNodeAdd(options: NodeAddOptions): number {
  const endpoint: NodeEndpoint =
    options.url !== undefined
      ? { kind: "http", baseUrl: options.url }
      : {
          kind: "rpc",
          ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
          ...(options.host === undefined ? {} : { host: options.host }),
          ...(options.port === undefined ? {} : { port: options.port }),
        };
  const registry = loadRegistry(options.dataDir);
  let node: NodeRecord;
  try {
    node = registry.add({
      name: options.name,
      endpoint,
      ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
      ...(options.credentialRef === undefined ? {} : { credentialRef: options.credentialRef }),
    });
  } catch (error) {
    // 配置写错时报一句人话，而不是甩一段调用栈。
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  saveRegistry(options.dataDir, registry);
  process.stdout.write(`已登记节点：${describeNode(node)}\n`);
  return 0;
}

export function runNodeList(options: { dataDir: string }): number {
  const nodes = loadRegistry(options.dataDir).list();
  if (nodes.length === 0) {
    process.stdout.write(
      "还没有登记任何节点。用 `node add --name <名字> --url <http://…>` 或 `--socket <路径>` 登记。\n",
    );
    return 0;
  }
  for (const node of nodes) process.stdout.write(`${describeNode(node)}\n`);
  return 0;
}

export function runNodeRemove(options: { dataDir: string; name: string }): number {
  const registry = loadRegistry(options.dataDir);
  if (!registry.remove(options.name)) {
    process.stderr.write(`没有名为 ${options.name} 的节点。\n`);
    return 1;
  }
  saveRegistry(options.dataDir, registry);
  process.stdout.write(`已移除节点 ${options.name}。\n`);
  return 0;
}
