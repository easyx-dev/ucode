/**
 * 转发给本机服务的请求头策略：剥哪一类、补哪一个。HTTP 与 WebSocket 两条转发路径共用这一份，
 * 所以「凭证必须被本侧重写」「Host 必须由本机决定」这类边界只在这里定义一次。
 *
 * 为什么必须由本侧重写而不是透传：隧道来的 `authorization` 是中继的设备/用户凭证，本机服务只认
 * 自己的 `serviceToken`；`host` 若被帧里的值带进来，`ws://127.0.0.1:19688@other/x` 这类路径
 * 会把请求指向别的主机。两者都不该有机会穿过这一跳。
 */
import type { IncomingHttpHeaders } from "node:http";

import type { HeaderMap } from "@ucode/hub-protocol";

/**
 * 逐跳头（RFC 9110 §7.6.1）：只对单跳有意义，两个方向都不能透传。
 * 尤其 `transfer-encoding` —— 分块方式由每一跳自己决定（本侧重切了块，中继那一跳还会再切一次）。
 */
export const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** 请求侧还要剥掉的：Host 由本侧决定，Content-Length 由重切块后的实际字节数决定，凭证由本侧补 */
const STRIPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  ...HOP_BY_HOP_HEADERS,
  "host",
  "content-length",
  "authorization",
  "cookie",
]);

/**
 * WS 握手额外要剥的：`sec-websocket-*` 由本机客户端自己生成（原样带过去会和它生成的那份冲突），
 * 上面四类同样不能进来。
 */
const isDroppedHandshakeHeader = (lowerName: string): boolean =>
  lowerName.startsWith("sec-websocket-") || STRIPPED_REQUEST_HEADERS.has(lowerName);

const copyWithout = (headers: HeaderMap, isDropped: (lowerName: string) => boolean): HeaderMap => {
  const forwarded: HeaderMap = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isDropped(name.toLowerCase())) continue;
    forwarded[name] = value;
  }
  return forwarded;
};

/** 普通 HTTP 转发：剥逐跳头与凭证，补本机 `serviceToken`；`x-hub-*` 原样透传（是中继注入的事实） */
export const buildUpstreamHeaders = (headers: HeaderMap, serviceToken: string): HeaderMap => ({
  ...copyWithout(headers, (name) => STRIPPED_REQUEST_HEADERS.has(name)),
  authorization: `Bearer ${serviceToken}`,
});

/** WS 握手：在普通请求的基础上再让 `sec-websocket-*` 由本机客户端生成 */
export const buildHandshakeHeaders = (headers: HeaderMap, serviceToken: string): HeaderMap => ({
  ...copyWithout(headers, isDroppedHandshakeHeader),
  authorization: `Bearer ${serviceToken}`,
});

/** 回给中继的响应头：只剥逐跳头，`content-type` / `cache-control` / `set-cookie` 等原样带过去 */
export const buildDownstreamHeaders = (headers: HeaderMap): HeaderMap =>
  copyWithout(headers, (name) => HOP_BY_HOP_HEADERS.has(name));

/**
 * `http` 的响应头 → 隧道协议的头表。同名多值保持数组：
 * `set-cookie` 按 RFC 不能逗号合并（`Expires` 自带逗号），压成一条会让浏览器把多条 cookie 当一条。
 */
export const toHeaderMap = (headers: IncomingHttpHeaders): HeaderMap => {
  const map: HeaderMap = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    map[name] = value;
  }
  return map;
};
