/** web 侧的客户端装配：创建实例并注入浏览器 fetch、凭证存储与 i18n 错误文案 */
import { sessionTokenStorageKey } from "@ucode/brand";
import type { Translate } from "@ucode/sdk";
import { createClient } from "@ucode/sdk";
import { appBasePath } from "./base-path";
import i18n from "./i18n";

/** SDK 侧传的是动态 key，i18next 的 t 由中文 key 类型约束；此处收口一次断言 */
export const translate = i18n.t as unknown as Translate;

/**
 * 会话 token 取本机 localStorage：同源多标签共享一份，刷新不掉登录；
 * 键一直固定，故同源下不同端口的两个实例各存各的（localStorage 按 origin 隔离）。
 */
const readToken = (): string | null => window.localStorage.getItem(sessionTokenStorageKey);

/** 挂在路径前缀下时（中继的 `/d/<设备 id>`），接口与页面同源但都要带前缀 */
const basePath = appBasePath();

export const client = createClient({
  translate,
  // 接口与页面同源（开发走 Vite、生产由服务托管）；终端输出流要 WebSocket，按同一来源换算即可
  baseUrl: basePath,
  websocketBaseUrl: `${window.location.origin.replace(/^http/, "ws")}${basePath}`,
  getToken: readToken,
  onToken: (token) => {
    if (token) window.localStorage.setItem(sessionTokenStorageKey, token);
    else window.localStorage.removeItem(sessionTokenStorageKey);
  },
});
