import { z } from "zod";

/**
 * 信任级别 = 认证的替代品（spec §2.2）。
 *
 * **它由绑定声明，不由客户端自报**（ADR-004）：对端声称自己可信等于没有信任模型。
 * 因此协议里这个类型只出现在核心层给出的方向（welcome 回告实际授予什么）。
 */
export const TrustLevelSchema = z.enum([
  /** 父进程 spawn（stdio）：对端本来就是这台机器的主人。 */
  "implicit",
  /** unix socket / 仅监听环回：对端是同一 OS 用户的进程。 */
  "local",
  /** 非环回且未认证：什么都证明不了，只是"没有身份"。 */
  "untrusted",
]);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

/**
 * 能力按面拆分，便于"操作被拒时能区分承载不了与信任不足"（spec §4.3）。
 * 绑定声明自己**能承载**什么（capabilities），核心层按信任矩阵回告**实际授予**什么（grantedCapabilities）。
 */
export const CapabilitySchema = z.enum([
  /** 读取会话：列表、状态、历史、分支结构。 */
  "sessions.read",
  /** 改动会话：新建、分叉、克隆、重命名、切换模型。 */
  "sessions.write",
  /** 发起一轮对话（prompt / steer / follow_up）。 */
  "prompt.run",
  /** 工具直调（bash 等）：未认证通路必须被裁掉。 */
  "tools.direct",
  /** 人类交互的应答权（批准权）。 */
  "interaction.respond",
  /** 驱动"免批准执行"的会话（自主级别门槛，spec §2.5）。 */
  "autonomy.unattended",
  /** 工作区文件 / Git 结构化查询通道。 */
  "channel.workspace",
  /** PTY 字节流通道。 */
  "channel.pty",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

/** 全部能力，便于测试与"给全权"的场合使用。 */
export const ALL_CAPABILITIES: readonly Capability[] = CapabilitySchema.options;

/** 会话的自主级别（第二条权限轴，spec §2.5 / ADR-021）。 */
export const AutonomyLevelSchema = z.enum([
  /** 变更前确认（默认）：任何通路都能驱动。 */
  "confirm",
  /** 自动编辑：只有本机等价或已认证且有授权的通路能驱动。 */
  "auto-edit",
  /** 计划模式：只读，不落改动。 */
  "plan",
  /** 完全访问：同 auto-edit 的门槛。 */
  "full-access",
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

/** 这个自主级别是否允许免批准执行（决定门槛是否生效）。 */
export function requiresTrustToDrive(level: AutonomyLevel): boolean {
  return level === "auto-edit" || level === "full-access";
}
