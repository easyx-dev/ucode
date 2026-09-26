import { z } from "zod";
import type { Capability } from "./trust.ts";
import { ReferenceSchema } from "./session.ts";
import { AutonomyLevelSchema } from "./trust.ts";

/**
 * 命令面（spec §4.4）。
 *
 * 分两段解析，理由是"解析失败必须能被识别，且不能假设请求里可用来关联的信息一定可用"：
 * 1. 先解析**信封**（type / id / command / sessionId）——信封成功就有了关联 id，失败则没有；
 * 2. 再按 command 名解析**参数**——参数失败仍能带 id 回一个可诊断的错误。
 */
export const CommandEnvelopeSchema = z.object({
  type: z.literal("command"),
  id: z.string().min(1),
  command: z.string().min(1),
  sessionId: z.string().nullable().default(null),
  args: z.unknown().default({}),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

const NoArgs = z.object({});

/** 每个命令的参数 schema。命令清单直接采用 spec §4.4 的【实现级】清单。 */
export const CommandArgsSchemas = {
  // 会话生命周期
  "session.create": z.object({
    cwd: z.string().optional(),
    name: z.string().optional(),
    autonomy: AutonomyLevelSchema.optional(),
  }),
  "session.list": NoArgs,
  "session.get_state": NoArgs,
  "session.get_entries": z.object({
    /** 从哪一行之后开始取（游标 = 行序号，header 为第 0 行）。 */
    fromSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(2000).optional(),
  }),
  "session.get_tree": NoArgs,
  "session.fork": z.object({
    fromId: z.string().nullable().optional(),
  }),
  "session.clone": NoArgs,
  "session.set_name": z.object({ name: z.string().min(1) }),
  "session.set_autonomy": z.object({ level: AutonomyLevelSchema }),
  "session.archive": z.object({ archived: z.boolean() }),
  /** 解决一个**持久化**的待决交互（无人值守场景：请求当时无人应答，已落盘；稍后有人来了）。 */
  "interaction.resolve": z.object({
    /** 持久化记录里的交互 id（不是实时的 ui.request id）。 */
    interactionId: z.string().min(1),
    value: z.union([z.string(), z.boolean(), z.null()]).default(null),
    cancelled: z.boolean().default(false),
  }),
  "session.attach": z.object({}),
  "session.detach": z.object({}),

  // 驱动
  prompt: z.object({
    text: z.string().min(1),
    references: z.array(ReferenceSchema).max(32).optional(),
  }),
  steer: z.object({ text: z.string().min(1) }),
  follow_up: z.object({ text: z.string().min(1) }),
  abort: NoArgs,
  clear_queue: NoArgs,

  // 配置
  "model.set": z.object({ provider: z.string().min(1), modelId: z.string().min(1) }),
  "model.list": NoArgs,
  "thinking.set": z.object({ level: z.string().min(1) }),
  compact: z.object({ instructions: z.string().optional() }),

  // 工具直调（受信任矩阵约束）
  bash: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
  "bash.abort": NoArgs,
} as const;

export type CommandName = keyof typeof CommandArgsSchemas;
export type CommandArgs<K extends CommandName> = z.infer<(typeof CommandArgsSchemas)[K]>;

export const COMMAND_NAMES = Object.keys(CommandArgsSchemas) as CommandName[];

export function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(CommandArgsSchemas, value);
}

/** 一条命令需要的能力（信任矩阵按"能力"裁剪，而不是按命令名硬编码在绑定里）。 */
export const COMMAND_CAPABILITIES: Record<CommandName, Capability> = {
  "session.create": "sessions.write",
  "session.list": "sessions.read",
  "session.get_state": "sessions.read",
  "session.get_entries": "sessions.read",
  "session.get_tree": "sessions.read",
  "session.fork": "sessions.write",
  "session.clone": "sessions.write",
  "session.set_name": "sessions.write",
  "session.set_autonomy": "sessions.write",
  "session.archive": "sessions.write",
  "interaction.resolve": "interaction.respond",
  "session.attach": "sessions.read",
  "session.detach": "sessions.read",
  prompt: "prompt.run",
  steer: "prompt.run",
  follow_up: "prompt.run",
  abort: "prompt.run",
  clear_queue: "prompt.run",
  "model.set": "sessions.write",
  "model.list": "sessions.read",
  "thinking.set": "sessions.write",
  compact: "sessions.write",
  bash: "tools.direct",
  "bash.abort": "tools.direct",
};

export type ParsedCommand =
  | {
      ok: true;
      id: string;
      command: CommandName;
      sessionId: string | null;
      args: unknown;
    }
  | {
      ok: false;
      /** 信封解析成功时可用；失败时为 null——调用方必须能处理没有 id 的情况。 */
      id: string | null;
      /** 失败原因分类：信封 / 未知命令 / 参数。 */
      stage: "envelope" | "unknown_command" | "args";
      command: string | null;
      message: string;
      issues?: unknown;
    };

/** 解析一条命令：先信封，再按命令名解析参数。 */
export function parseCommand(raw: unknown): ParsedCommand {
  const envelope = CommandEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      ok: false,
      id: null,
      stage: "envelope",
      command: null,
      message: "命令信封解析失败：缺少 type/id/command 等必需字段。",
      issues: envelope.error.issues,
    };
  }

  const { id, command, sessionId, args } = envelope.data;
  if (!isCommandName(command)) {
    return {
      ok: false,
      id,
      stage: "unknown_command",
      command,
      message: `未知命令：${command}`,
    };
  }

  const parsedArgs = CommandArgsSchemas[command].safeParse(args ?? {});
  if (!parsedArgs.success) {
    return {
      ok: false,
      id,
      stage: "args",
      command,
      message: `命令 ${command} 的参数不合法。`,
      issues: parsedArgs.error.issues,
    };
  }

  return { ok: true, id, command, sessionId, args: parsedArgs.data };
}

/** 在处理器内部取强类型参数（handler 已按命令名注册，这里的断言是安全的）。 */
export function commandArgs<K extends CommandName>(_command: K, args: unknown): CommandArgs<K> {
  return args as CommandArgs<K>;
}
