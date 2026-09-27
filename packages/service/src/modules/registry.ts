import type { ExtensionAPI, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AutonomyLevel } from "@ucode/protocol";
import { createGoalExtension } from "./goal/extension.ts";
import { createHooksExtension } from "./hooks/extension.ts";
import { createImportExtension } from "./import/extension.ts";
import { createMcpExtension } from "./mcp/extension.ts";
import { createMemoryExtension } from "./memory/extension.ts";
import { createQuestionExtension } from "./question/extension.ts";
import { createSshExtension } from "./ssh/extension.ts";
import { createSubagentsExtension } from "./subagents/extension.ts";
import { createUndoExtension } from "./undo/extension.ts";
import { createWikiExtension } from "./wiki/extension.ts";

/**
 * 会话级装配表——**唯一的装配点**。
 *
 * 业务模块往一台会话里装东西，只有这一条路：新增一个域 = 在下面这张表里加一行，
 * 而不是去 `session/runtime.ts` 里改数组、再去命令分发里加分支。
 *
 * 一个模块可以贡献三张脸（见 docs/02-服务层内部.md）：**agent 面**（这里的 `create`）、
 * **服务面**（协议 C 命令，由 service.ts 的域处理器提供）、**存储面**（自己的文件或 SQLite 表）。
 * 只有 agent 面的模块在这张表里就够了。
 *
 * **工具闸门不在这张表里**：它是平台扩展（每个会话都必须有，且必须在业务工具之前生效），
 * 由会话运行时自己装配——放在这里会让人误以为"可以不装"。
 */

export type SessionModuleContext = {
  /** 数据根：业务模块自己推导 service / pi 两侧的路径。 */
  root: string;
  cwd: string;
  sessionId: string;
  modelRuntime: ModelRuntime;
  /** 当前会话的自主级别（可变）。 */
  autonomy: () => AutonomyLevel;
  /** 本会话内被"总是允许"的工具。 */
  sessionAllowed: Set<string>;
  /** 决策审计（谁批了什么）。 */
  onDecision?: (decision: { toolName: string; approved: boolean; reason: string }) => void;
  /** 面向用户的提醒（服务层转成 `ui.notify` 广播给该会话的所有 attachment）。 */
  onNotice?: (level: "info" | "warn" | "error", message: string) => void;
};

/** 一个 pi 扩展工厂（可异步：MCP 这类要等外部进程握手完才能注册工具）。 */
export type SessionExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;

export type SessionModule = {
  name: string;
  /** 这个模块对"一台会话"的贡献；与 pi 的扩展契约完全一致。 */
  create?: (context: SessionModuleContext) => SessionExtensionFactory | undefined;
};

export const SESSION_MODULES: SessionModule[] = [
  {
    name: "memory",
    create: (context) => createMemoryExtension({ dataDir: context.root, cwd: context.cwd }),
  },
  {
    name: "subagents",
    create: (context) =>
      createSubagentsExtension({
        dataDir: context.root,
        cwd: context.cwd,
        modelRuntime: context.modelRuntime,
        autonomy: context.autonomy,
        sessionAllowed: context.sessionAllowed,
      }),
  },
  {
    name: "goal",
    create: (context) =>
      createGoalExtension({
        dataDir: context.root,
        cwd: context.cwd,
        modelRuntime: context.modelRuntime,
        autonomy: context.autonomy,
      }),
  },
  { name: "undo", create: () => createUndoExtension() },
  {
    name: "wiki",
    create: (context) =>
      createWikiExtension({
        dataDir: context.root,
        cwd: context.cwd,
        modelRuntime: context.modelRuntime,
      }),
  },
  { name: "ssh", create: (context) => createSshExtension({ dataDir: context.root }) },
  {
    name: "import",
    create: (context) => createImportExtension({ dataDir: context.root, cwd: context.cwd }),
  },
  { name: "question", create: () => createQuestionExtension() },
  {
    name: "mcp",
    create: (context) =>
      createMcpExtension({
        root: context.root,
        ...(context.onNotice === undefined ? {} : { onNotice: context.onNotice }),
      }),
  },
  {
    name: "hooks",
    create: (context) =>
      createHooksExtension({
        dataDir: context.root,
        cwd: context.cwd,
        sessionId: context.sessionId,
        onDecision: (decision) =>
          context.onDecision?.({
            toolName: decision.hook,
            approved: decision.approved,
            reason: `hook:${decision.event}:${decision.reason}`,
          }),
      }),
  },
];

/** 按表装配：返回**有 agent 面**的模块的扩展工厂，顺序与表一致。 */
export function sessionExtensionFactories(
  context: SessionModuleContext,
): SessionExtensionFactory[] {
  const factories: SessionExtensionFactory[] = [];
  for (const module of SESSION_MODULES) {
    const factory = module.create?.(context);
    if (factory !== undefined) factories.push(factory);
  }
  return factories;
}
