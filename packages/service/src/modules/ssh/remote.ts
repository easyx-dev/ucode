import { spawn } from "node:child_process";
import type { SshConnection } from "./registry.ts";

/**
 * 远端命令执行（F-6.5）。
 *
 * 两条安全约定：
 * 1. **按 argv 传参，不拼 shell 字符串**——远程命令作为 `ssh` 的**单个**参数传过去，
 *    由远端 shell 解释。本地不参与拼接，因此本地不存在命令注入面；
 * 2. **BatchMode=yes**：绝不在无 TTY 的场景下等口令输入（那会把整轮挂死）。
 *    `StrictHostKeyChecking=accept-new` 兼顾"首次连接可用"与"改过指纹就拒绝"。
 *
 * `exec` 可注入：测试用假执行器断言 argv 形状与结果映射，不必真连一台机器。
 */

export type SshExecResult = { stdout: string; stderr: string; exitCode: number };
export type SshExec = (
  file: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<SshExecResult>;

export type RunRemoteOptions = {
  timeoutMs?: number;
  exec?: SshExec;
  /** 远端工作目录（可选）。 */
  cwd?: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export function remoteTarget(connection: SshConnection): string {
  return connection.user === undefined ? connection.host : `${connection.user}@${connection.host}`;
}

/** 组装 `ssh` 的 argv（不含可执行文件名）。命令原样作为最后一个参数。 */
export function sshArgv(connection: SshConnection, command: string): string[] {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
  ];
  if (connection.port !== undefined) args.push("-p", String(connection.port));
  if (connection.identityFile !== undefined) args.push("-i", connection.identityFile);
  args.push(remoteTarget(connection));
  // 远端 cwd 通过 `cd -- <path> && <cmd>` 实现（见 runRemote）；命令原样作为最后一个参数。
  args.push(command);
  return args;
}

export async function runRemote(
  connection: SshConnection,
  command: string,
  options: RunRemoteOptions = {},
): Promise<SshExecResult> {
  const exec = options.exec ?? defaultExec;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const before =
    options.cwd === undefined ? command : `cd -- ${shellQuote(options.cwd)} && ${command}`;
  return exec("ssh", sshArgv(connection, before), { timeoutMs });
}

/** 单引号包裹（远端 shell 用），内部单引号按 POSIX 规则转义。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

const defaultExec: SshExec = (file, args, { timeoutMs }) =>
  new Promise<SshExecResult>((resolve) => {
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(124); // 与 timeout(1) 的约定一致
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 1_000_000) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 100_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += String(error);
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 0));
  });
