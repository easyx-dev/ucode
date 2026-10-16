/** 消息接口的请求 zod 模型；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

import { PROMPT_MAX_ATTACHMENTS, PROMPT_MAX_CONTEXTS, PROMPT_MAX_SKILLS } from "../constants";
import { sessionIdSchema } from "../sessions/input";

export const messageListInputSchema = z.object({ sessionId: sessionIdSchema });

/** 单独读一次后台服务清单（面板打开时用）；服务端在响应前重探一次再返回 */
export const messageServicesInputSchema = z.object({ sessionId: sessionIdSchema });

/**
 * 附件引用：`id` 是上传接口返回的内容 hash（64 位小写 hex，sha256）。
 * 图片与非图片都用同一套引用；服务端按入库的 mimeType 决定发给模型还是只做引用。
 */
export const attachmentRefSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/),
});

/** `@` 上下文引用：绝对路径或工作目录相对路径 + 可选行范围；服务端读内容后前置进正文 */
export const contextRefSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

/**
 * 提示词命令调用（最多一条）：名字 + 参数。参数是**标记形态**的正文（`@路径` / `图片 N` /
 * `附件 N.ext`），模板里的 `$ARGUMENTS` 等占位按它替换；`text` 是容器外的用户正文。
 *
 * 名字与参数的边界由客户端在发送前定形（方言的 `:::command[name]` 容器，见
 * `@ucode/markdown`），服务端只按名字查模板——它不再从正文里切 `/name`，所以参数里的标点、
 * 空白原样属于用户那句话（见 docs/api.md「输入载荷」）。
 */
export const commandRefSchema = z.object({
  /** 命令模板文件名（不含 `.md`） */
  name: z.string().min(1),
  args: z.string().default(""),
});

/** 技能调用（可多条，按出现顺序注入）：名字 + 该技能自己的参数，同样是标记形态 */
export const skillRefSchema = z.object({
  /** 技能名（目录名或 `SKILL.md` 所在目录） */
  name: z.string().min(1),
  args: z.string().default(""),
});

/**
 * 编辑一条已发送的用户消息并重发：`entryId` 是消息 DTO 的 id（即 pi 条目 id），
 * 服务端对着活动分支校验（不在活动分支 / 非用户消息一律 400）；旧分支保留在会话文件里。
 *
 * `contexts` / `attachments` / `command` / `skills` 与 `promptInputSchema` 同形：原消息里的引用、附件与
 * 命令由编辑器还原后一并回传，重发时才不会丢掉它们（附件只需 id——引用按内容寻址，重建不需要其余
 * 视图信息）。四项至少一项非空（空输入在服务端拒掉）：命令调用可以只有 `command`（如无参数的 `/review`）。
 */
export const messageEditInputSchema = z.object({
  sessionId: sessionIdSchema,
  entryId: z.string().min(1),
  text: z.string().default(""),
  contexts: z.array(contextRefSchema).max(PROMPT_MAX_CONTEXTS).optional(),
  attachments: z.array(attachmentRefSchema).max(PROMPT_MAX_ATTACHMENTS).optional(),
  command: commandRefSchema.optional(),
  skills: z.array(skillRefSchema).max(PROMPT_MAX_SKILLS).optional(),
});

/**
 * 发起一轮生成；服务端受理后返回 ack，生成在后台继续、结果走 /events。
 * 会话必须先由 `sessions/create` 建好（工作目录也是那时定的）——服务端不做隐式创建，
 * 创建只有一条路径，所以这里不带任何会话级设置。
 *
 * `text` 允许为空串：只要 `contexts` 或 `attachments` 非空即可；「三者至少一项」由路由层校验，
 * 这样纯附件 / 纯引用消息也能发送。
 */
export const promptInputSchema = z.object({
  sessionId: sessionIdSchema,
  /** 用户写的正文（`@` 引用与附件的位置标记都在里面）；命令与技能不在这里，见 `command` / `skills` */
  text: z.string().default(""),
  contexts: z.array(contextRefSchema).max(PROMPT_MAX_CONTEXTS).optional(),
  attachments: z.array(attachmentRefSchema).max(PROMPT_MAX_ATTACHMENTS).optional(),
  /** 这条输入是一条命令调用时带上（最多一条）；缺省即普通消息 */
  command: commandRefSchema.optional(),
  /** 这条输入用到的技能（可多条，按顺序注入）；与 `command` 可以并存 */
  skills: z.array(skillRefSchema).max(PROMPT_MAX_SKILLS).optional(),
  /** 生成中再发消息时的投递方式 */
  behavior: z.enum(["follow-up", "steer"]).default("follow-up"),
});

/**
 * 手动压缩上下文；`instructions` 可给自定义总结要求，省略即用默认总结。
 * 与生成一样只做受理，压缩在服务端后台执行、结果走 /events（`compaction_start` / `compaction_end`）。
 */
export const messageCompactInputSchema = z.object({
  sessionId: sessionIdSchema,
  instructions: z.string().trim().min(1).optional(),
});

export type MessageListRequest = z.input<typeof messageListInputSchema>;
export type MessageListInput = z.infer<typeof messageListInputSchema>;
export type MessageServicesRequest = z.input<typeof messageServicesInputSchema>;
export type MessageServicesInput = z.infer<typeof messageServicesInputSchema>;
export type MessageEditRequest = z.input<typeof messageEditInputSchema>;
export type MessageEditInput = z.infer<typeof messageEditInputSchema>;
export type MessageCompactRequest = z.input<typeof messageCompactInputSchema>;
export type MessageCompactInput = z.infer<typeof messageCompactInputSchema>;

/**
 * 批准计划：模式由客户端先经 `sessions/update` 切回 `build`，这里只负责注入
 * 「计划已批准，请开始执行。」并起一轮——自定义条目只有服务端写得进去。
 */
export const messageApprovePlanInputSchema = z.object({ sessionId: sessionIdSchema });

export type MessageApprovePlanRequest = z.input<typeof messageApprovePlanInputSchema>;
export type MessageApprovePlanInput = z.infer<typeof messageApprovePlanInputSchema>;
export type CommandRefInput = z.infer<typeof commandRefSchema>;
export type CommandRefRequest = z.input<typeof commandRefSchema>;
export type CommandRef = CommandRefInput;
export type SkillRefInput = z.infer<typeof skillRefSchema>;
export type SkillRefRequest = z.input<typeof skillRefSchema>;
export type SkillRef = SkillRefInput;
export type AttachmentRefInput = z.infer<typeof attachmentRefSchema>;
export type AttachmentRefRequest = z.input<typeof attachmentRefSchema>;
export type AttachmentRef = AttachmentRefInput;
export type ContextRefInput = z.infer<typeof contextRefSchema>;
export type ContextRefRequest = z.input<typeof contextRefSchema>;
export type ContextRef = ContextRefInput;
export type PromptInput = z.infer<typeof promptInputSchema>;
export type PromptRequest = z.input<typeof promptInputSchema>;
