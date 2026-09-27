import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  addConnection,
  findConnection,
  listConnections,
  removeConnection,
  type SshConnection,
} from "./registry.ts";
import { runRemote } from "./remote.ts";

/**
 * AI SSH 工具（F-6.5）：让 agent 能"登上"已登记的远端机器执行命令。
 *
 * - `list`：列出已登记连接（名称、目标、说明）；
 * - `add` / `remove`：维护注册表（**不存密钥**，只存连接定义）；
 * - `run`：在指定连接上执行一条命令，把 stdout/stderr/退出码原样带回。
 *
 * 为什么是"命令"而不是"交互式 shell"：非交互能把结果结构化地带回给模型（退出码、输出），
 * 交互式控制台走 PTY 通道（另一条路）；两者共用同一个注册表。
 */

export type SshExtensionOptions = { dataDir: string };

type SshToolDetails = {
  action: string;
  name?: string;
  exitCode?: number;
};

export function createSshExtension(options: SshExtensionOptions): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const tool = defineTool({
      name: "ssh",
      label: "Remote SSH",
      description:
        "在已登记的远端机器上执行命令。action=list 看有哪些连接；add 登记新连接（name/host/user/port/identityFile，不存密钥）；" +
        "remove 删除；run 在指定连接上执行一条命令并取回 stdout/stderr/退出码。命令按参数传递，不经本地 shell 拼接。",
      parameters: Type.Object({
        action: Type.Union(
          [Type.Literal("list"), Type.Literal("add"), Type.Literal("remove"), Type.Literal("run")],
          { description: "要做的操作" },
        ),
        name: Type.Optional(
          Type.String({ description: "连接名（run/remove 必填；add 时为新连接名）" }),
        ),
        host: Type.Optional(Type.String({ description: "add：主机名或 IP" })),
        user: Type.Optional(Type.String({ description: "add：登录用户" })),
        port: Type.Optional(Type.Number({ description: "add：端口" })),
        identityFile: Type.Optional(Type.String({ description: "add：私钥文件路径（可选）" })),
        description: Type.Optional(Type.String({ description: "add：说明" })),
        command: Type.Optional(Type.String({ description: "run：要在远端执行的命令" })),
      }),

      async execute(_toolCallId, params): Promise<AgentToolResult<SshToolDetails>> {
        switch (params.action) {
          case "list": {
            const connections = await listConnections(options.dataDir);
            if (connections.length === 0) {
              return {
                content: [{ type: "text", text: "还没有登记任何 SSH 连接。用 action=add 登记。" }],
                details: { action: "list" },
              };
            }
            const text = connections
              .map((connection) => {
                const target =
                  connection.user === undefined
                    ? connection.host
                    : `${connection.user}@${connection.host}`;
                const port = connection.port === undefined ? "" : `:${connection.port}`;
                const note =
                  connection.description === undefined ? "" : ` — ${connection.description}`;
                return `- ${connection.name} → ${target}${port}${note}`;
              })
              .join("\n");
            return { content: [{ type: "text", text }], details: { action: "list" } };
          }
          case "add": {
            if (params.name === undefined || params.host === undefined) {
              throw new Error("add 需要 name 与 host。");
            }
            const input: SshConnection = { name: params.name, host: params.host };
            if (params.user !== undefined) input.user = params.user;
            if (params.port !== undefined) input.port = params.port;
            if (params.identityFile !== undefined) input.identityFile = params.identityFile;
            if (params.description !== undefined) input.description = params.description;
            const saved = await addConnection(options.dataDir, input);
            return {
              content: [
                { type: "text", text: `已登记连接 ${saved.name} → ${saved.host}（未存密钥）。` },
              ],
              details: { action: "add", name: saved.name },
            };
          }
          case "remove": {
            if (params.name === undefined) throw new Error("remove 需要 name。");
            const removed = await removeConnection(options.dataDir, params.name);
            if (!removed) throw new Error(`没有名为 ${params.name} 的连接。`);
            return {
              content: [{ type: "text", text: `已删除连接 ${params.name}。` }],
              details: { action: "remove", name: params.name },
            };
          }
          case "run": {
            if (params.name === undefined) throw new Error("run 需要 name。");
            if (params.command === undefined || params.command.trim() === "") {
              throw new Error("run 需要 command。");
            }
            const connection = await findConnection(options.dataDir, params.name);
            if (connection === undefined) {
              const known = (await listConnections(options.dataDir)).map((item) => item.name);
              throw new Error(
                `没有名为 ${params.name} 的连接（可用：${known.join(", ") || "无"}）。`,
              );
            }
            const result = await runRemote(connection, params.command);
            const body = [
              `退出码：${result.exitCode}`,
              result.stdout.trim() === "" ? "" : `stdout:\n${result.stdout.trim()}`,
              result.stderr.trim() === "" ? "" : `stderr:\n${result.stderr.trim()}`,
            ]
              .filter((part) => part !== "")
              .join("\n");
            return {
              content: [{ type: "text", text: body }],
              details: { action: "run", name: connection.name, exitCode: result.exitCode },
            };
          }
        }
      },
    });

    pi.registerTool(tool);
  };
}
