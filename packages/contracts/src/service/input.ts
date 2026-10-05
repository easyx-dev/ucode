/** service 域的请求 schema：监听地址等只影响本进程绑定、需重启生效的服务级开关 */
import { z } from "zod";

/** 监听地址：`127.0.0.1` 仅本机，`0.0.0.0` 允许局域网 */
export const serviceHostInputSchema = z.object({
  host: z.enum(["127.0.0.1", "0.0.0.0"]),
});

export type ServiceHostInput = z.infer<typeof serviceHostInputSchema>;
export type ServiceHostRequest = z.input<typeof serviceHostInputSchema>;
