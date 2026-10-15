/**
 * WebSocket 握手票的通用实现：一次性、短时、绑定某个资源。
 *
 * 为什么需要它：浏览器的 WebSocket API 带不了自定义请求头，`app://desktop` 那样的跨源场景也带不上 Cookie，
 * 所以握手时校验的不是长期凭证，而是客户端先用一次**带鉴权的普通请求**换来的票——票放 URL 里不算泄露
 * 长期凭证，用完即废（与 opencode 的 `pty/connect-token` 同一思路）。
 *
 * 预检与核销分开是刻意的：预检给鉴权中间件当准入门槛（无效票连连接都不该建立），**不消耗票**；
 * 消耗只发生在真正建连的那条路径上，所以拿到票后一次连接失败还能再试一次直到过期。
 *
 * 票只活在进程内存里，进程重启即失效（终端与浏览器实例本来就活在内存里，票跟着它们即可）。
 * 过期的票在签发与核销时顺手清掉，不另起定时器。
 */
import { randomUUID } from "node:crypto";

/** 票的有效期：只够「拿到票 → 立刻建连接」这一段 */
export const HANDSHAKE_TICKET_TTL_MS = 30_000;

export type IssuedTicket = {
  /** 一次性票据，放进 WebSocket URL 的 `ticket` 查询参数 */
  ticket: string;
  /** 过期时间（ISO），客户端不必用，留给排障与展示 */
  expiresAt: string;
};

export type HandshakeTickets<TBound> = {
  /** 给某个资源签一张票 */
  issue: (bound: TBound) => IssuedTicket;
  /** 预检：票存在、未过期、且绑在这个资源上（不消耗） */
  peek: (ticket: string, bound: TBound) => boolean;
  /** 核销：返回票绑定的资源；不存在、已过期或已用过都返回 null */
  redeem: (ticket: string) => TBound | null;
};

type TicketRecord<TBound> = {
  bound: TBound;
  expiresAt: number;
};

export const createHandshakeTickets = <TBound>(
  options: { ttlMs?: number; now?: () => number } = {},
): HandshakeTickets<TBound> => {
  const ttlMs = options.ttlMs ?? HANDSHAKE_TICKET_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const tickets = new Map<string, TicketRecord<TBound>>();

  const sweep = (): void => {
    const stamp = now();
    for (const [ticket, record] of tickets) {
      if (record.expiresAt <= stamp) tickets.delete(ticket);
    }
  };

  return {
    issue(bound) {
      sweep();
      const ticket = randomUUID();
      const expiresAt = now() + ttlMs;
      tickets.set(ticket, { bound, expiresAt });
      return { ticket, expiresAt: new Date(expiresAt).toISOString() };
    },

    peek(ticket, bound) {
      const record = tickets.get(ticket);
      if (!record) return false;
      if (record.expiresAt <= now()) return false;
      return record.bound === bound;
    },

    redeem(ticket) {
      const record = tickets.get(ticket);
      if (!record) {
        // 只签发不核销的挂机场景里，过期票攒在这里没有别的回收时机
        sweep();
        return null;
      }
      tickets.delete(ticket);
      if (record.expiresAt <= now()) return null;
      return record.bound;
    },
  };
};
