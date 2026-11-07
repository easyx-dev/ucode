/**
 * 本机服务的转发目标：地址取注册文件（端口自选时只有它写着真实端口），凭证同源。
 *
 * 「注册文件缺失就回落 env」被刻意去掉：那等于探测失败即静默改道，生产实例的 `.env` 会让请求
 * 打到生产端口上。读不到注册文件就不转发，由调用方回 `local_unavailable`。
 */
import { env } from "../../env";
import { readServiceRegistration, toUrlHost } from "../../platform/service-registration";

/** 本机服务的转发目标 */
export type LocalTarget = {
  /** 如 `http://127.0.0.1:19688`，无末尾斜杠 */
  origin: string;
  serviceToken: string;
};

/** 读一次注册文件（连接建立时调，随会话持有，不必每个流读一次盘） */
export const resolveLocalTarget = (): LocalTarget | null => {
  const registration = readServiceRegistration(env.servicePath);
  if (!registration) return null;
  const { port, serviceToken, host } = registration;
  if (!serviceToken || !(port > 0)) return null;
  return { origin: `http://${toUrlHost(host)}:${port}`, serviceToken };
};

/**
 * 路径必须是绝对路径：`//host` 会被当成协议相对地址而换掉主机，
 * `http://127.0.0.1:19688@other/x` 同理——两种形态都拒掉。
 */
const isForwardablePath = (path: string): boolean => path.startsWith("/") && !path.startsWith("//");

/** 拼普通 HTTP 的上游 URL */
export const resolveUpstreamUrl = (target: LocalTarget, path: string): URL | null => {
  if (!isForwardablePath(path)) return null;
  try {
    return new URL(`${target.origin}${path}`);
  } catch {
    return null;
  }
};

/** 拼 WebSocket 的上游端点：同一套路径判据，只换协议头 */
export const resolveUpgradeUrl = (target: LocalTarget, path: string): string | null => {
  if (!isForwardablePath(path)) return null;
  return `${target.origin.replace(/^http/, "ws")}${path}`;
};
