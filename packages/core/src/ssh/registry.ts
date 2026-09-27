import { readFile } from "node:fs/promises";
import { storePaths, writeFileAtomic } from "@ucode/store";

/**
 * SSH 连接注册表（F-6.5）。
 *
 * **刻意不存密钥、不存口令**：只存"连哪台机、用哪个用户、用哪个密钥文件"这类定义。
 * 认证交给 `ssh` 自己（`~/.ssh/config`、ssh-agent、IdentityFile）。理由是数据层里的
 * 明文密钥一旦被同步/备份/截图就会长期泄漏，而 ssh 生态本来就有成熟的凭据管理。
 *
 * 数据层只存一份 `ssh.json`——连接定义是"这台机器信任哪些远端"的清单，量小、需人可读可改。
 */

export type SshConnection = {
  /** 登记名（工具里用它引用，如 `prod`）。 */
  name: string;
  host: string;
  user?: string;
  port?: number;
  /** 私钥文件路径（可选：不填就走 ssh config / agent）。 */
  identityFile?: string;
  /** 说明，便于人辨认。 */
  description?: string;
};

export const SSH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

export function isValidConnectionName(name: string): boolean {
  return SSH_NAME_PATTERN.test(name);
}

export function sshFileFor(dataDir: string): string {
  return storePaths(dataDir).ssh;
}

export async function listConnections(dataDir: string): Promise<SshConnection[]> {
  const raw = await readRegistry(dataDir);
  return raw.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findConnection(
  dataDir: string,
  name: string,
): Promise<SshConnection | undefined> {
  return (await readRegistry(dataDir)).find((connection) => connection.name === name);
}

export async function addConnection(dataDir: string, input: SshConnection): Promise<SshConnection> {
  const normalized = normalizeConnection(input);
  const connections = await readRegistry(dataDir);
  const next = [
    ...connections.filter((connection) => connection.name !== normalized.name),
    normalized,
  ];
  await writeRegistry(dataDir, next);
  return normalized;
}

export async function removeConnection(dataDir: string, name: string): Promise<boolean> {
  const connections = await readRegistry(dataDir);
  const next = connections.filter((connection) => connection.name !== name);
  if (next.length === connections.length) return false;
  await writeRegistry(dataDir, next);
  return true;
}

export function normalizeConnection(input: SshConnection): SshConnection {
  const name = input.name.trim();
  if (!isValidConnectionName(name)) {
    throw new Error(`非法的连接名 ${input.name}（只允许字母/数字/._-，且以字母或数字开头）。`);
  }
  const host = input.host.trim();
  if (host === "") throw new Error("连接需要 host。");
  // 主机名/用户名里出现 shell 元字符一律拒绝：我们按 argv 传参（不经 shell），但这类输入
  // 几乎总是配置写错或被注入，早点报错比"跑了奇怪的东西"好。
  if (/[\s;&|`$<>(){}[\]*?!\\'"]/u.test(host)) throw new Error(`host 含有非法字符：${input.host}`);
  // 空字符串按"没填"处理（表单里常见），只有非空才校验。
  if (input.user !== undefined && input.user !== "" && !/^[A-Za-z0-9._-]+$/u.test(input.user)) {
    throw new Error(`user 含有非法字符：${input.user}`);
  }
  if (
    input.port !== undefined &&
    (!Number.isInteger(input.port) || input.port <= 0 || input.port > 65535)
  ) {
    throw new Error(`端口非法：${String(input.port)}`);
  }
  const connection: SshConnection = { name, host };
  if (input.user !== undefined && input.user !== "") connection.user = input.user;
  if (input.port !== undefined) connection.port = input.port;
  if (input.identityFile !== undefined && input.identityFile !== "") {
    connection.identityFile = input.identityFile;
  }
  if (input.description !== undefined && input.description !== "") {
    connection.description = input.description;
  }
  return connection;
}

async function readRegistry(dataDir: string): Promise<SshConnection[]> {
  let raw: string;
  try {
    raw = await readFile(sshFileFor(dataDir), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { connections?: unknown }).connections;
  if (!Array.isArray(list)) return [];
  const out: SshConnection[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const value = item as Record<string, unknown>;
    if (typeof value.name !== "string" || typeof value.host !== "string") continue;
    out.push({
      name: value.name,
      host: value.host,
      ...(typeof value.user === "string" ? { user: value.user } : {}),
      ...(typeof value.port === "number" ? { port: value.port } : {}),
      ...(typeof value.identityFile === "string" ? { identityFile: value.identityFile } : {}),
      ...(typeof value.description === "string" ? { description: value.description } : {}),
    });
  }
  return out;
}

async function writeRegistry(dataDir: string, connections: SshConnection[]): Promise<void> {
  await writeFileAtomic(sshFileFor(dataDir), JSON.stringify({ connections }, null, 2), {
    mode: 0o600,
  });
}
