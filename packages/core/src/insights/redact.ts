/**
 * 导出前的**脱敏**（F-5.7）。
 *
 * 导出的支持包是要发出去的东西（发给同事、贴进 issue），**任何密钥都不该在里面**。
 * 脱敏按"可疑的键名"递归替换，而不是按已知的键白名单——白名单会随供应商增加而漏，
 * 黑名单式（键名像密钥就抹掉）虽然可能多抹一点，但错的方向是对的。
 */

/** 键名命中即抹掉其值（大小写不敏感）。 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /api[-_]?key/iu,
  /secret/iu,
  /token/iu,
  /password/iu,
  /passwd/iu,
  /credential/iu,
  /authorization/iu,
  /private[-_]?key/iu,
  /session[-_]?key/iu,
  /cookie/iu,
];

export const REDACTED = "«已脱敏»";

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/** 值本身像密钥也抹掉（防止"键名正常、值是 sk-..."的情形）。 */
export function looksLikeSecretValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /(^sk-[A-Za-z0-9_-]{8,})|(^gh[pous]_[A-Za-z0-9]{16,})|(^AKIA[0-9A-Z]{16})|(^ey[A-Za-z0-9_-]{20,}\.)/u.test(
    value,
  );
}

export function redact<T>(value: T): T {
  return redactValue(value, 0) as T;
}

function redactValue(value: unknown, depth: number): unknown {
  // 防环与防爆：导出的是配置与日志，正常不会有深层嵌套；超过就当不可序列化处理。
  if (depth > 12) return "«过深，已省略»";
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (typeof value !== "object" || value === null) {
    return looksLikeSecretValue(value) ? REDACTED : value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      out[key] = child === undefined || child === null || child === "" ? child : REDACTED;
      continue;
    }
    out[key] = redactValue(child, depth + 1);
  }
  return out;
}
