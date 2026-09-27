import { z } from "zod";
import { ReferenceSchema } from "./session.ts";
import type { Capability } from "./trust.ts";
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
    /** 临时会话（F-1.5 辅助对话）：不落盘、不进列表、重启即消失。 */
    ephemeral: z.boolean().optional(),
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
  /** 编辑历史对话（F-1.3）：改写某条记录的上下文；content 为 null 表示从上下文剔除。 */
  "session.edit_entry": z.object({
    entryId: z.string().min(1),
    content: z.string().nullable(),
  }),
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

  // 供应商配置（F-5.3）：模型选择器的前提——没有它，新用户只能看到空列表，
  // 且界面没有任何入口告诉他"要先配一个端点"。
  "provider.list": NoArgs,
  "provider.add": z.object({
    id: z.string().min(1),
    baseUrl: z.string().min(1),
    /** 线上 API 形态；省略按 `openai-completions`（OpenAI 兼容端点）。 */
    api: z.string().min(1).optional(),
    /** 密钥只入不出：写进去，读回来的形状里没有它。 */
    apiKey: z.string().min(1).optional(),
    models: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().optional(),
          input: z.array(z.string()).optional(),
          contextWindow: z.number().int().positive().optional(),
          maxTokens: z.number().int().positive().optional(),
        }),
      )
      .min(1),
    /** 同时把它设为默认模型（写进 settings.json）。 */
    makeDefault: z.boolean().optional(),
  }),
  "provider.remove": z.object({ id: z.string().min(1) }),

  // 工具直调（受信任矩阵约束）
  bash: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
  "bash.abort": NoArgs,

  // 自动化任务（F-4.1 定时 / F-4.2 闲时 / F-4.3 绑定）
  "task.list": NoArgs,
  "task.create": z.object({
    kind: z.enum(["cron", "idle"]),
    prompt: z.string().min(1),
    cwd: z.string().optional(),
    cron: z.string().optional(),
    delayMinutes: z.number().positive().optional(),
    everyMinutes: z.number().positive().optional(),
    sessionId: z.string().min(1).nullish(),
    autonomy: AutonomyLevelSchema.optional(),
  }),
  "task.cancel": z.object({ taskId: z.string().min(1) }),
  "task.pause": z.object({ taskId: z.string().min(1) }),
  "task.resume": z.object({ taskId: z.string().min(1) }),
  "task.run": z.object({ taskId: z.string().min(1) }),

  // 用量统计 / 支持包导出 / 数据迁移（F-5.6~5.8）
  "stats.usage": NoArgs,
  "support.export": z.object({
    /** 支持包里带几个日志文件（尾部）。 */
    maxLogFiles: z.number().int().positive().max(50).optional(),
  }),
  "migration.preflight": z.object({ from: z.string().min(1) }),
  "migration.import": z.object({
    from: z.string().min(1),
    onConflict: z.enum(["skip", "overwrite"]).optional(),
  }),

  // 插件市场（F-3.6）
  "marketplace.overview": NoArgs,
  "marketplace.catalog": z.object({ source: z.string().min(1) }),
  "marketplace.add_source": z.object({
    name: z.string().min(1),
    kind: z.enum(["local", "remote"]),
    location: z.string().min(1),
    description: z.string().optional(),
  }),
  "marketplace.remove_source": z.object({ name: z.string().min(1) }),
  "marketplace.install": z.object({
    source: z.string().min(1),
    plugin: z.string().min(1),
    overwrite: z.boolean().optional(),
  }),
  "marketplace.uninstall": z.object({
    kind: z.enum(["skill", "prompt", "agent", "extension"]),
    name: z.string().min(1),
  }),
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
  "session.edit_entry": "sessions.write",
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
  // 配模型是"改本机权威配置"，与写会话同级；密钥只写不读（见 ProviderSummary）。
  "provider.list": "sessions.read",
  "provider.add": "sessions.write",
  "provider.remove": "sessions.write",
  "thinking.set": "sessions.write",
  compact: "sessions.write",
  bash: "tools.direct",
  "bash.abort": "tools.direct",
  "task.list": "sessions.read",
  "task.create": "sessions.write",
  "task.cancel": "sessions.write",
  "task.pause": "sessions.write",
  "task.resume": "sessions.write",
  "task.run": "prompt.run",
  "stats.usage": "sessions.read",
  // 导出会在数据层写一个包文件（虽不含会话正文，仍是写操作）。
  "support.export": "sessions.write",
  "migration.preflight": "sessions.read",
  "migration.import": "sessions.write",
  "marketplace.overview": "sessions.read",
  "marketplace.catalog": "sessions.read",
  // 登记源 / 装 / 卸都是写操作（扩展还是可执行代码，装它受批准门槛约束）。
  "marketplace.add_source": "sessions.write",
  "marketplace.remove_source": "sessions.write",
  "marketplace.install": "sessions.write",
  "marketplace.uninstall": "sessions.write",
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
