import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { AutonomyLevel } from "@ucode/protocol";
import { createToolGateExtension } from "../tool-gate.ts";
import type { SubagentProfile } from "./profile.ts";

/**
 * 子智能体的执行（F-2.3）。
 *
 * 子智能体是**另一个 agent session**：独立上下文、独立工具集、跑完把结论回给主对话。
 * 三条约束在这里落地：
 * 1. **工具闸门继承**——子会话同样挂 `tool-gate`（共享父会话的自主级别与"本会话总是允许"），
 *    因此子智能体不会成为"绕过批准的后门"；
 * 2. **不挂记忆与子智能体工具**——避免递归派生子智能体，也符合 F-2.5"记忆仅主对话生效"；
 * 3. **轮次护栏**——超过 `maxTurns` 主动中止，避免子智能体打转烧额度。
 */

export type SubagentRunOptions = {
  profile: SubagentProfile;
  task: string;
  cwd: string;
  dataDir: string;
  modelRuntime: ModelRuntime;
  /** 父会话的自主级别（子会话继承）。 */
  autonomy: () => AutonomyLevel;
  /** 父会话的"本会话总是允许"集合（子会话共享）。 */
  sessionAllowed: Set<string>;
  /** 一旦置位，立即中止子会话。 */
  signal?: AbortSignal;
};

export type SubagentRunResult = {
  name: string;
  status: "completed" | "failed";
  text: string;
  error?: string;
  turns: number;
};

export async function runSubagent(options: SubagentRunOptions): Promise<SubagentRunResult> {
  const { profile } = options;
  let session: AgentSession | undefined;
  let turns = 0;
  let exceeded = false;

  try {
    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: options.dataDir,
      extensionFactories: [
        createToolGateExtension({
          autonomy: options.autonomy,
          sessionAllowed: options.sessionAllowed,
          noUiReason: `子智能体 ${profile.name} 需要批准，但子会话没有交互通路，已按策略拒绝。`,
        }),
      ],
    });
    await loader.reload();

    const available = await options.modelRuntime.getAvailable();
    const model = available[0];

    const created = await createAgentSession({
      cwd: options.cwd,
      agentDir: options.dataDir,
      modelRuntime: options.modelRuntime,
      ...(model === undefined ? {} : { model }),
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(options.cwd),
      ...(profile.tools === undefined ? {} : { tools: profile.tools }),
      ...(profile.disallowedTools === undefined ? {} : { excludeTools: profile.disallowedTools }),
    });
    session = created.session;

    const maxTurns = profile.maxTurns;
    const unsubscribe = session.subscribe((event) => {
      if ((event as { type?: string }).type !== "turn_end") return;
      turns += 1;
      if (maxTurns !== undefined && turns >= maxTurns) {
        exceeded = true;
        void session?.abort();
      }
    });

    const onAbort = (): void => void session?.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await session.prompt(options.task);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }

    if (exceeded) {
      return {
        name: profile.name,
        status: "failed",
        text: session.getLastAssistantText() ?? "",
        error: `超过轮次上限（${String(maxTurns)}）。`,
        turns,
      };
    }
    return {
      name: profile.name,
      status: "completed",
      text: session.getLastAssistantText() ?? "",
      turns,
    };
  } catch (error) {
    return {
      name: profile.name,
      status: "failed",
      text: "",
      error: error instanceof Error ? error.message : String(error),
      turns,
    };
  } finally {
    session?.dispose();
  }
}
