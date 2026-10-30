/** hub 域的请求 schema：登录中继、把它的模型端点写成本机 provider */
import { z } from "zod";

/** 登录中继：地址可省（已存过就用本机那份），账号密码必填 */
export const hubLoginInputSchema = z.object({
  /** 中继服务地址；省略时用本机已保存的地址（都没有则报「未配置中继地址」） */
  url: z.string().optional(),
  /** 中继上的登录账号（管理端或客户端账号都认） */
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export type HubLoginInput = z.infer<typeof hubLoginInputSchema>;
export type HubLoginRequest = z.input<typeof hubLoginInputSchema>;

/**
 * 把中继的模型端点写成本机 provider：无参数。
 * 端点、凭证与 provider id 都取自本机的中继配置（id 固定为 `relay`，见 `docs/hub.md`）。
 */
export const hubProviderInputSchema = z.object({});

export type HubProviderInput = z.infer<typeof hubProviderInputSchema>;
