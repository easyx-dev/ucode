import { z } from "zod";

/**
 * 通道（spec §4.7）：通道类型是一等概念，不是"先转发消息、字节流以后再补"。
 *
 * 首发定义两条通道：
 * 1. **工作区文件 / Git 结构化查询**——控制层要渲染文件树与 Git 图谱，工作区在核心层那台机器上。
 *    不能用工具调用代替：那会把 UI 性能绑在命令解析上。
 * 2. **PTY 字节流**——终端仿真需要双向字节流 + 窗口尺寸变更 + 信号，塞进 JSON 消息面会毁掉体验。
 *
 * 通道帧与消息面共用同一路连接（绑定只做序列化与寻址），因此中继可以按通道转发不透明字节。
 */
export const ChannelKindSchema = z.enum(["workspace", "pty"]);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;

// ── 工作区查询（结构化请求-应答） ──

export const WorkspaceTreeParamsSchema = z.object({
  path: z.string().optional(),
  depth: z.number().int().positive().max(8).optional(),
  /** 只列出匹配的条目（简单的后缀/包含匹配，避免把 glob 引擎带进核心层）。 */
  filter: z.string().optional(),
});

export const WorkspaceGitLogParamsSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  skip: z.number().int().nonnegative().optional(),
});

export const WorkspaceReadParamsSchema = z.object({
  path: z.string(),
  maxBytes: z.number().int().positive().max(2_000_000).optional(),
});

export const WorkspaceMethodSchema = z.enum(["tree", "git.log", "git.changes", "read"]);
export type WorkspaceMethod = z.infer<typeof WorkspaceMethodSchema>;

// 查询结果形状（F-2.7/F-2.8）。核心层是产出方，控制层据此渲染文件树/Git 图谱/预览。
export type WorkspaceTreeEntry = {
  /** 相对工作区根的路径。 */
  path: string;
  name: string;
  kind: "file" | "dir";
  size?: number;
  mtime?: string;
};
export type WorkspaceTreeResult = { root: string; entries: WorkspaceTreeEntry[] };
export type WorkspaceGitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};
export type WorkspaceGitLogResult = { commits: WorkspaceGitCommit[]; hasMore: boolean };
export type WorkspaceGitChange = { path: string; status: string };
export type WorkspaceGitChangesResult = { changes: WorkspaceGitChange[] };
export type WorkspaceReadResult = {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
};

export const ChannelOpenSchema = z.object({
  type: z.literal("channel.open"),
  channelId: z.string().min(1),
  channel: ChannelKindSchema,
  params: z.unknown().optional(),
});

export const ChannelCloseSchema = z.object({
  type: z.literal("channel.close"),
  channelId: z.string().min(1),
});

export const ChannelRequestSchema = z.object({
  type: z.literal("channel.request"),
  id: z.string().min(1),
  channelId: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

/** PTY 上行字节（base64：JSON 里不能放裸字节）。 */
export const ChannelDataSchema = z.object({
  type: z.literal("channel.data"),
  channelId: z.string().min(1),
  data: z.string(),
});

/** 窗口尺寸变更与信号：PTY 的必需能力（V-7 已验证）。 */
export const ChannelResizeSchema = z.object({
  type: z.literal("channel.resize"),
  channelId: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const ChannelSignalSchema = z.object({
  type: z.literal("channel.signal"),
  channelId: z.string().min(1),
  signal: z.string().min(1),
});

export const ChannelOpenedSchema = z.object({
  type: z.literal("channel.opened"),
  channelId: z.string().min(1),
  channel: ChannelKindSchema,
  /** 工作区通道回告工作目录；PTY 回告实际尺寸。 */
  params: z.unknown().optional(),
});

export const ChannelClosedSchema = z.object({
  type: z.literal("channel.closed"),
  channelId: z.string().min(1),
  reason: z.string().optional(),
});

export const ChannelResponseSchema = z.object({
  type: z.literal("channel.response"),
  id: z.string().min(1),
  channelId: z.string().min(1),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export const ChannelEventSchema = z.object({
  type: z.literal("channel.event"),
  channelId: z.string().min(1),
  event: z.unknown(),
});

export const ClientChannelMessageSchema = z.discriminatedUnion("type", [
  ChannelOpenSchema,
  ChannelCloseSchema,
  ChannelRequestSchema,
  ChannelDataSchema,
  ChannelResizeSchema,
  ChannelSignalSchema,
]);

export const ServerChannelMessageSchema = z.discriminatedUnion("type", [
  ChannelOpenedSchema,
  ChannelClosedSchema,
  ChannelResponseSchema,
  ChannelDataSchema,
  ChannelEventSchema,
]);

export type ClientChannelMessage = z.infer<typeof ClientChannelMessageSchema>;
export type ServerChannelMessage = z.infer<typeof ServerChannelMessageSchema>;
