/** auth 域的请求 schema；`*Request` 为客户端载荷（z.input），`*Input` 为服务端解析后（z.infer） */
import { z } from "zod";

/** 密码登录：`label` 是会话标签（设备名等），缺省时服务端补默认 */
export const authLoginInputSchema = z.object({
  password: z.string().min(1),
  label: z.string().trim().max(60).optional(),
});

export type AuthLoginInput = z.infer<typeof authLoginInputSchema>;
export type AuthLoginRequest = z.input<typeof authLoginInputSchema>;

/** 修改超管密码；成功后撤销全部会话 */
export const authPasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export type AuthPasswordInput = z.infer<typeof authPasswordInputSchema>;
export type AuthPasswordRequest = z.input<typeof authPasswordInputSchema>;

/** 撤销指定会话（按登录会话 id） */
export const authSessionRevokeInputSchema = z.object({
  authSessionId: z.string().min(1),
});

export type AuthSessionRevokeInput = z.infer<typeof authSessionRevokeInputSchema>;
export type AuthSessionRevokeRequest = z.input<typeof authSessionRevokeInputSchema>;
