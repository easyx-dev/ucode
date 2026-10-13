/**
 * 头部状态底色：把「生成中 / 待填表单 / 待权限审批」收敛成三种色调。
 *
 * 优先级与 `server/src/core/session-status.ts` 同序（待审批 > 待填表单 > 生成中），
 * 这样头部底色与侧栏状态、决定区的显隐不会互相打架。
 * `streaming` 是客户端的乐观信号：刚发出消息时服务端状态还是 `idle`，
 * 不看它会让底色迟一拍（与侧栏列表的 `running` 合并同一考虑）。
 */
import type { SessionStatus } from "../../types";

/** 头部要表达的三态 */
export type SessionTone = "busy" | "form" | "permission";

export const sessionToneOf = (status: SessionStatus, streaming: boolean): SessionTone | null => {
  if (status === "waiting_permission") return "permission";
  if (status === "waiting_question" || status === "waiting_plan") return "form";
  if (status === "running" || streaming) return "busy";
  return null;
};
