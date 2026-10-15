/**
 * 握手票的通用实现单测：一次性、限期、绑定资源三者缺一不可，且预检不消耗票。
 * 时间可注入，过期不靠真实等待。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createHandshakeTickets } from "../handshake-tickets";

const withClock = (ttlMs = 1_000) => {
  let now = 1_000;
  const tickets = createHandshakeTickets<string>({ ttlMs, now: () => now });
  return { tickets, advance: (ms: number) => (now += ms) };
};

describe("createHandshakeTickets", () => {
  it("签票后预检通过，绑错的资源不通过", () => {
    const { tickets } = withClock();
    const issued = tickets.issue("work");
    assert.equal(tickets.peek(issued.ticket, "work"), true);
    assert.equal(tickets.peek(issued.ticket, "other"), false);
    assert.equal(tickets.peek("no-such-ticket", "work"), false);
  });

  it("预检不消耗票：建连前可以反复检查", () => {
    const { tickets } = withClock();
    const issued = tickets.issue("work");
    tickets.peek(issued.ticket, "work");
    tickets.peek(issued.ticket, "work");
    assert.equal(tickets.redeem(issued.ticket), "work");
  });

  it("核销是一次性的：重放同一张票拿不到第二次", () => {
    const { tickets } = withClock();
    const issued = tickets.issue("work");
    assert.equal(tickets.redeem(issued.ticket), "work");
    assert.equal(tickets.redeem(issued.ticket), null);
    assert.equal(tickets.peek(issued.ticket, "work"), false);
  });

  it("过期票既不通过预检也核销不出来", () => {
    const { tickets, advance } = withClock(1_000);
    const issued = tickets.issue("work");
    advance(1_001);
    assert.equal(tickets.peek(issued.ticket, "work"), false);
    assert.equal(tickets.redeem(issued.ticket), null);
  });

  it("过期时间随 ttl 给出，供排障展示", () => {
    const { tickets, advance } = withClock(1_000);
    const issued = tickets.issue("work");
    advance(0);
    assert.equal(typeof issued.ticket, "string");
    assert.ok(Number.isFinite(Date.parse(issued.expiresAt)));
  });
});
