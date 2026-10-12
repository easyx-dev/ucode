/**
 * 公共网络底座：出网准入（SSRF 守卫）+ 取流（手动跟随重定向、每跳重新准入、字节上限）。
 *
 * 工具层（webfetch）与插件市场 / 包拉取共用这一份。取流返回**字节**而不是文本：
 * 市场清单要解码成 UTF-8，插件包是 zip / tgz 压缩体，由调用方决定怎么读。
 * 条件请求所需的 `ETag` / `Last-Modified` 一并回传，缓存与更新判定交给调用方。
 */
import { assertPublicUrl, BlockedTargetError } from "./ssrf";

export { assertPublicUrl, BlockedTargetError } from "./ssrf";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 出网体积上限：压缩体按它截断，超出即视为失败（缓存 / 安装都不该接受半截内容） */
export type PublicFetchResult = {
  /** 最终落点（跟随重定向之后） */
  url: URL;
  /** HTTP 状态：是否算失败由调用方决定（工具报错、市场落诊断、包拉取直接拒） */
  status: number;
  /** 响应体字节：命中 `maxBytes` 时为截断后的内容，`truncated` 为 true */
  body: Uint8Array;
  truncated: boolean;
  contentType: string | null;
  /** 条件请求用；服务端没给就是 null */
  etag: string | null;
  lastModified: string | null;
};

/** 按字节上限读取响应体；到上限即停读并取消后续，避免为超大响应把内存吃满 */
const readBodyLimited = async (
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> => {
  if (!body) return { bytes: new Uint8Array(), truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - total;
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, Math.max(remaining, 0)));
        total += Math.max(remaining, 0);
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: joined, truncated };
};

/** 手动跟随重定向：每一跳都重新做目标准入，`redirect: "follow"` 做不到这件事 */
const fetchFollowingRedirects = async (input: {
  url: string;
  headers: Record<string, string>;
  maxRedirects: number;
  signal: AbortSignal;
}): Promise<{ url: URL; response: Response }> => {
  let target = await assertPublicUrl(input.url);

  for (let hop = 0; hop <= input.maxRedirects; hop += 1) {
    const response = await fetch(target, {
      redirect: "manual",
      headers: input.headers,
      signal: input.signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return { url: target, response };

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new BlockedTargetError(`重定向缺少 Location：${target.href}`);
    target = await assertPublicUrl(new URL(location, target));
  }

  throw new BlockedTargetError(`重定向超过 ${input.maxRedirects} 次，已放弃`);
};

export type PublicFetchInput = {
  url: string;
  /** 附加请求头（条件请求、鉴权等）；`accept` 与 `user-agent` 由调用方给默认值 */
  headers?: Record<string, string>;
  /** 响应体上限；超出即截断（`truncated` 为 true） */
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  /** 外部取消信号（会话中断、超时） */
  signal?: AbortSignal;
};

/**
 * 取公网资源：准入 → 手动重定向 → 限长读体。
 * 网络错误与受限目标都直接抛出，由调用方决定记成什么诊断。
 */
export const publicFetch = async (input: PublicFetchInput): Promise<PublicFetchResult> => {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

  const { url, response } = await fetchFollowingRedirects({
    url: input.url,
    headers: input.headers ?? {},
    maxRedirects: input.maxRedirects ?? 5,
    signal,
  });

  const { bytes, truncated } = await readBodyLimited(response.body, input.maxBytes);
  return {
    url,
    status: response.status,
    body: bytes,
    truncated,
    contentType: response.headers.get("content-type"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
};
