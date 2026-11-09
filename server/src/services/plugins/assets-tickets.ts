/**
 * 插件界面资源的读取票：模块与样式要经浏览器的 `import()` / `<link>` 取，而这两条路都带不了
 * `Authorization` 头——所以用一张短时票放在 URL 里（与 WebSocket 握手票同一思路，见
 * `services/handshake-tickets.ts`）。
 *
 * 与握手票的差别只在有效期：握手是「拿到票立刻建连」，插件模块则是随界面懒加载的，可能隔几分钟
 * 才点开某个视图，所以给 10 分钟。票绑在「插件资源」这个用途上，不能用于任何接口调用。
 */
import { createHandshakeTickets } from "../handshake-tickets";

/** 票的有效期：够一次浏览会话里点开各处插件界面，又不至于长期躺在 URL 里 */
export const PLUGIN_ASSET_TICKET_TTL_MS = 10 * 60_000;

/** 票绑定的用途：只有一个值，写成对象是为了让「绑了什么」在类型上可见 */
export type PluginAssetScope = { scope: "plugin-assets" };

/** 票的绑定值：同一个对象实例，`peek` 按引用比对（见 `createHandshakeTickets`） */
const SCOPE: PluginAssetScope = { scope: "plugin-assets" };

const tickets = createHandshakeTickets<PluginAssetScope>({ ttlMs: PLUGIN_ASSET_TICKET_TTL_MS });

/** 签一张票；界面贡献清单与它一起下发 */
export const issuePluginAssetTicket = (): { ticket: string; expiresAt: string } => {
  const issued = tickets.issue(SCOPE);
  return { ticket: issued.ticket, expiresAt: issued.expiresAt };
};

/** 预检（不消耗）：鉴权中间件用它给「取插件资源」的 GET 放行 */
export const peekPluginAssetTicket = (ticket: string | undefined): boolean =>
  ticket !== undefined && tickets.peek(ticket, SCOPE);
