import { ALL_CAPABILITIES, type Capability, type TrustLevel } from "@ucode/protocol";

/**
 * 信任矩阵（spec §2.3）。
 *
 * 三条边界里这里只处理第一条：**绑定信任**。它的判断依据不是"分级"，而是
 * "这条通路需不需要身份认证"：
 *
 * | 通路 | 它证明了什么 | 给什么 |
 * |---|---|---|
 * | stdio（父进程 spawn） | 对端本来就是这台机器的主人 | 全部 |
 * | unix socket（受文件权限约束） | 对端是同一 OS 用户的进程 | 全部；高危操作需交互确认 |
 * | HTTP/WS 只监听 loopback | 同上 | 同上 |
 * | HTTP/WS 监听非环回、未认证 | 什么都证明不了 | 只读 + 对话 |
 *
 * 最后一行的 untrusted **不是"比较不可信"，而是"没有身份，因此不能给它自主权"**。
 */

const FULL: readonly Capability[] = ALL_CAPABILITIES;

/** 未认证通路：只读 + 对话。工具直调关闭、不具批准权、不能驱动免批准执行的会话。 */
const UNTRUSTED_READ_ONLY: readonly Capability[] = ["sessions.read", "prompt.run"];

const ALLOWED_BY_TRUST: Record<TrustLevel, readonly Capability[]> = {
  implicit: FULL,
  local: FULL,
  untrusted: UNTRUSTED_READ_ONLY,
};

/**
 * 按信任矩阵裁剪**客户端声明的能力**。
 *
 * 注意方向：客户端声明的是"我能承载什么"，核心层决定"实际授予什么"。
 * 两者分离正是为了可诊断——被拒时要能区分"承载不了"与"能承载但信任不足"（spec §4.3）。
 */
export function grantCapabilities(
  trustLevel: TrustLevel,
  declared: readonly Capability[],
): Capability[] {
  const allowed = new Set(ALLOWED_BY_TRUST[trustLevel]);
  return declared.filter((capability) => allowed.has(capability));
}

/** 核心层自身支持的能力全集（不含信任判断）。 */
export function coreCapabilities(): Capability[] {
  return [...ALL_CAPABILITIES];
}

/**
 * 自主级别门槛（spec §2.5 / ADR-021）。
 *
 * **两条轴的关系不是取交集，而是一道门槛**：自主级别允许免批准执行时，
 * 只有「结构性等价于本机用户」的通路或「已认证且有授权」的通路才能驱动该会话。
 * 没有这道门槛，一个未认证通路的客户端只要发一句话，agent 就会免批准照做。
 */
export function canDriveUnattended(trustLevel: TrustLevel): boolean {
  return trustLevel === "implicit" || trustLevel === "local";
}

/** 是否具备应答交互（批准）的资格。untrusted 不具应答权（spec §2.6）。 */
export function canRespondToInteraction(trustLevel: TrustLevel): boolean {
  return trustLevel === "implicit" || trustLevel === "local";
}

/** 交互请求的路由优先级：已认证 > 未认证；未认证内部按来历排序（spec §2.6）。 */
export function interactionPriority(trustLevel: TrustLevel): number {
  switch (trustLevel) {
    case "implicit":
      return 0;
    case "local":
      return 1;
    case "untrusted":
      return 2;
  }
}
