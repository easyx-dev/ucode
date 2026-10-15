/**
 * 终端输出流的入场券：WebSocket 握手用的一次性凭证。
 *
 * 浏览器的 WebSocket API 不能带自定义请求头，`app://desktop` 那样的跨源场景也带不上 Cookie，
 * 所以握手时校验的不是长期凭证，而是客户端先用一次**带鉴权的普通请求**换来的短时、单次可用的票
 * （票放 URL 里不算泄露长期凭证，用完即废）。做法与 opencode 的 `pty/connect-token` 同一思路。
 */
import { randomUUID } from "node:crypto";

/** 票的有效期：只够「拿到票 → 立刻建连接」这一段 */
const TICKET_TTL_MS = 30_000;

type TicketRecord = {
  terminalId: string;
  expiresAt: number;
};

export type IssuedTicket = {
  /** 一次性票据，放进 WebSocket URL 的 `ticket` 查询参数 */
  ticket: string;
  /** 过期时间（ISO），客户端不必用，留给排障与展示 */
  expiresAt: string;
};

/**
 * 票据表：只在内存里，进程重启即失效（终端本来就活在内存里，票据跟着它即可）。
 * 过期的票在签发与核销时顺手清掉，不另起定时器。
 */
export class TerminalTicketStore {
  private readonly tickets = new Map<string, TicketRecord>();

  /** 给某个终端签一张票 */
  issue(terminalId: string): IssuedTicket {
    this.sweep();
    const ticket = randomUUID();
    const expiresAt = Date.now() + TICKET_TTL_MS;
    this.tickets.set(ticket, { terminalId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /**
   * 预检一张票但不消耗它：给鉴权中间件当准入门槛用（无效票连连接都不该建立）。
   * 预检与核销分开是刻意的——预检失败不该废掉一张好票，消耗只发生在真正建连的那条路径上。
   */
  peek(ticket: string, terminalId: string): boolean {
    const record = this.tickets.get(ticket);
    if (!record) return false;
    if (record.expiresAt <= Date.now()) return false;
    return record.terminalId === terminalId;
  }

  /**
   * 核销一张票：返回它绑定的终端 id；票不存在、已过期或已被用过都返回 null。
   * 一次性的含义就在这里——取出的同时删掉，重放同一张票拿不到第二次连接。
   */
  redeem(ticket: string): string | null {
    const record = this.tickets.get(ticket);
    if (!record) {
      // 只签发不核销的挂机场景里，过期票攒在这里没有别的回收时机
      this.sweep();
      return null;
    }
    this.tickets.delete(ticket);
    if (record.expiresAt <= Date.now()) return null;
    return record.terminalId;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt <= now) this.tickets.delete(ticket);
    }
  }
}
