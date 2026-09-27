import { z } from "zod";
import { SessionSummarySchema } from "./session.ts";
import { CapabilitySchema, TrustLevelSchema } from "./trust.ts";
import { PROTOCOL_VERSION } from "./version.ts";

/**
 * 握手（spec §4.3）。
 *
 * 三条硬要求：
 * 1. **能力声明与能力授予分离**：hello 说"我能承载什么"，welcome 说"实际授予什么"；
 * 2. **版本双向校验**：双方都校验，不支持则显式拒绝（欢迎消息带 CoreRejected 分支）；
 * 3. **从不静默降级**：不匹配是显式错误。
 *
 * 注意：**客户端不报信任级别**（ADR-004）。信任由服务层侧的绑定声明，welcome 里回告。
 */

/** 控制层自称的形态，仅用于显示与审计；不参与任何权限判断。 */
export const ClientKindSchema = z.enum(["cli", "tui", "web", "desktop", "test", "unknown"]);
export type ClientKind = z.infer<typeof ClientKindSchema>;

/** 身份载荷：信息性，不涉及可验证性（spec §4.3）。服务层只记下"这条 attachment 属于谁"。 */
export const IdentitySchema = z.object({
  user: z.string().nullable(),
  device: z.string().nullable(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const HelloSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.number().int().positive(),
  clientId: z.string(),
  clientKind: ClientKindSchema,
  /** 绑定名，用于诊断（stdio / unix / http / ws）。 */
  binding: z.string(),
  /** 控制层**声明**自己能为这个会话承载哪些交互能力（不是请求权限）。 */
  capabilities: z.array(CapabilitySchema).default([]),
  /** 认证载荷：首发恒为空（置位不实现，spec §5.3）。 */
  auth: z.null().default(null),
  identity: IdentitySchema.default({ user: null, device: null }),
  /** 断线续传：带上上次收到的位置，请服务层补齐缺失部分。 */
  resume: z
    .object({
      sessionId: z.string(),
      fromSeq: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
});
export type Hello = z.infer<typeof HelloSchema>;

export const WelcomeSchema = z.object({
  type: z.literal("welcome"),
  protocolVersion: z.number().int().positive(),
  coreId: z.string(),
  /** 服务层声明自己支持的能力全集。 */
  capabilities: z.array(CapabilitySchema),
  /** 按信任矩阵实际授予这条 attachment 的能力。 */
  grantedCapabilities: z.array(CapabilitySchema),
  /** 服务层为这条通路判定的信任级别（不是客户端自报）。 */
  trustLevel: TrustLevelSchema,
  /** 磁盘数据格式版本（如 `v1`）：便于诊断"壳与服务看的不是同一份布局"。 */
  dataFormatVersion: z.string(),
  sessions: z.array(SessionSummarySchema),
  /** 续传时告知客户端"你的游标是否还有效"。 */
  resumeAck: z
    .object({
      sessionId: z.string(),
      fromSeq: z.number().int().nonnegative(),
      /** false 表示游标已失效（如格式迁移），客户端必须重新全量同步（spec §4.5）。 */
      valid: z.boolean(),
      cursor: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
});
export type Welcome = z.infer<typeof WelcomeSchema>;

/** 显式拒绝：版本或能力不匹配（从不静默降级）。 */
export const RejectedSchema = z.object({
  type: z.literal("rejected"),
  code: z.enum(["version_unsupported", "auth_required", "malformed_hello"]),
  message: z.string(),
  coreProtocolVersion: z.number().int().positive(),
  minReadableProtocolVersion: z.number().int().positive(),
});
export type Rejected = z.infer<typeof RejectedSchema>;

/** 当前实现声明的协议版本（供握手比对与测试使用）。 */
export const CURRENT_PROTOCOL_VERSION = PROTOCOL_VERSION;
