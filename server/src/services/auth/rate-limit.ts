/**
 * 登录限流：进程内滑动窗口，按来源 IP 计数。
 *
 * 威胁模型是网络攻击者爆破密码（本机原生客户端直接用 serviceToken，不走登录），
 * 因此只覆盖登录接口；窗口内超限即拒绝，成功登录不额外奖励额度。
 */
import { LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS } from "../../constants/auth";

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max = LOGIN_RATE_LIMIT_MAX,
    private readonly windowMs = LOGIN_RATE_LIMIT_WINDOW_MS,
  ) {}

  /** 记录一次尝试并返回是否放行 */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** 清理空键，避免 Map 随不同来源无限增长 */
  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, hits] of this.hits) {
      const recent = hits.filter((at) => at > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}
