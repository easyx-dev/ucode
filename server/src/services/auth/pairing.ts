/**
 * 一次性配对码：内存表，服务重启即失效。
 *
 * 用于「已登录的应用端生成链接 → 对方浏览器打开即接入」：高熵、5 分钟 TTL、单次兑换即废。
 * 表键是码的 sha256，明文只在生成时返回一次，避免内存里散落明文。
 */
import { createHash, randomBytes } from "node:crypto";

import { PAIRING_TTL_MS } from "../../constants/auth";

/** 兑换结果：`invalid` 不存在、`expired` 已过期、`ok` 成功（并已消费） */
export type PairingRedeemResult = "ok" | "expired" | "invalid";

export type IssuedPairing = {
  code: string;
  expiresAt: string;
};

const hashPairingCode = (code: string): string => createHash("sha256").update(code).digest("hex");

export class PairingStore {
  private readonly entries = new Map<string, { expiresAt: number }>();

  create(now = Date.now()): IssuedPairing {
    const code = randomBytes(24).toString("base64url");
    const expiresAt = now + PAIRING_TTL_MS;
    this.entries.set(hashPairingCode(code), { expiresAt });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** 兑换并消费；无论成功与否都作废该码 */
  redeem(code: string, now = Date.now()): PairingRedeemResult {
    const key = hashPairingCode(code);
    const entry = this.entries.get(key);
    if (!entry) return "invalid";
    this.entries.delete(key);
    return entry.expiresAt <= now ? "expired" : "ok";
  }

  prune(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
