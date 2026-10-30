/**
 * 对中继（hub）的 HTTP 调用：登录换令牌，登记 / 吊销本机设备。
 *
 * 只有这三个接口——数据面不经 HTTP（走隧道），所以这里保持一组无状态函数，不持有配置：
 * 地址与令牌由调用方从 `state.ts` 取，失败一律抛 `HubClientError`（`code` 供上层转成 API 错误码）。
 */
import {
  HUB_DEVICE_REGISTER_PATH,
  HUB_DEVICE_REVOKE_PATH,
  HUB_HTTP_TIMEOUT_MS,
  HUB_LOGIN_PATH,
} from "../../constants/hub";

export const HUB_CLIENT_ERROR_CODES = {
  /** 连不上中继：地址非法、DNS / 连接 / TLS 失败或超时 */
  unreachable: "hub_unreachable",
  /** 中继不认这份凭证：登录态失效，或设备令牌已被吊销 */
  unauthorized: "hub_unauthorized",
  /** 被中继限流 */
  rateLimited: "hub_rate_limited",
  /** 中继回了其它非 2xx */
  rejected: "hub_rejected",
  /** 中继回了 2xx 但结构认不出来 */
  invalidResponse: "hub_invalid_response",
} as const;

export type HubClientErrorCode =
  (typeof HUB_CLIENT_ERROR_CODES)[keyof typeof HUB_CLIENT_ERROR_CODES];

/**
 * 中继调用失败：`message` 是中文兜底（带上下文前缀，给日志与直接显示用），
 * `detail` 是**不含前缀的底层原因**（如 `fetch failed`、中继回的 `{ error }`）——
 * 界面的文案 key 自己带「无法连接中继 {{url}}」这类前缀，route 要把 detail 传进去才不会重复。
 */
export class HubClientError extends Error {
  constructor(
    readonly code: HubClientErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly detail: string = message,
  ) {
    super(message);
    this.name = "HubClientError";
  }
}

/** 中继回的设备：只取本侧要用的字段，其余留在中继 */
export type HubDevice = {
  id: string;
  name: string;
  /** 平台标识（darwin / win32 / linux）；中继侧可选 */
  platform: string | null;
  clientVersion: string | null;
  /** active / revoked */
  status: string;
  /** 该设备当前是否有活隧道 */
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string | null;
};

export type HubLoginInput = { username: string; password: string };

export type HubLoginResult = {
  token: string;
  expiresAt: string | null;
  user: { id: string; username: string; type: string };
};

export type HubRegisterDeviceInput = {
  name: string;
  platform?: string;
  clientVersion?: string;
};

export type HubRegisterDeviceResult = {
  device: HubDevice;
  /** 设备令牌明文，只在中继的这一响应里回一次 */
  token: string;
};

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** 中继回的设备结构 → 本侧结构；缺 id 视为认不出的响应（其余字段尽力取，缺了给中性默认值） */
export const toHubDevice = (value: unknown): HubDevice | null => {
  const raw = recordOf(value);
  const id = readString(raw?.id);
  if (!id) return null;

  return {
    id,
    name: readString(raw?.name) ?? id,
    platform: readString(raw?.platform),
    clientVersion: readString(raw?.clientVersion),
    status: readString(raw?.status) ?? "active",
    online: raw?.online === true,
    lastSeenAt: readString(raw?.lastSeenAt),
    createdAt: readString(raw?.createdAt),
  };
};

/**
 * 非 2xx 的映射：状态码定错误码，中继的 `{ error }` 文案优先——它比状态码具体
 * （「设备令牌无效或已吊销」比「中继返回 401」有用得多），拿不到就用状态码兜底。
 */
export const hubFailureOf = (
  status: number,
  payload: unknown,
): { code: HubClientErrorCode; message: string; detail: string } => {
  const code =
    status === 401 || status === 403
      ? HUB_CLIENT_ERROR_CODES.unauthorized
      : status === 429
        ? HUB_CLIENT_ERROR_CODES.rateLimited
        : HUB_CLIENT_ERROR_CODES.rejected;
  const detail = readString(recordOf(payload)?.error);
  return {
    code,
    message: detail ? `中继返回 ${status}：${detail}` : `中继返回 ${status}`,
    // 兜底文案里不复述状态码，但插值用的 reason 得说清是 HTTP 层失败
    detail: detail ?? `HTTP ${status}`,
  };
};

const reasonOf = (error: unknown): string => {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `超时（${HUB_HTTP_TIMEOUT_MS} ms）`;
  }
  return error instanceof Error ? error.message : String(error);
};

/** 响应体解析成 JSON：非 JSON 或空体返回 null，由调用方按状态码决定这算失败还是结构不对 */
const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

type HubRequest = {
  /** 中继地址（`state.getHubConfig().url`） */
  url: string;
  path: string;
  method: "GET" | "POST";
  /** 登录令牌；登录接口本身没有 */
  token?: string | null;
  body?: unknown;
};

const callHub = async (input: HubRequest): Promise<unknown> => {
  let target: URL;
  try {
    // 拼而不是 `new URL(path, url)`：`/` 开头的路径会按 origin 解析，把中继地址里的路径前缀丢掉
    // （与 `tunnel.ts` 的 `toTunnelUrl`、`provider.ts` 的 `hubModelBaseUrl` 同一口径）
    target = new URL(`${input.url.replace(/\/+$/, "")}${input.path}`);
  } catch {
    throw new HubClientError(
      HUB_CLIENT_ERROR_CODES.unreachable,
      `中继地址不可用：${input.url}`,
      null,
      "地址不可用",
    );
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: input.method,
      headers: {
        accept: "application/json",
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
        ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(HUB_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = reasonOf(error);
    throw new HubClientError(
      HUB_CLIENT_ERROR_CODES.unreachable,
      `无法连接中继 ${input.url}：${reason}`,
      null,
      reason,
    );
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const failure = hubFailureOf(response.status, payload);
    throw new HubClientError(failure.code, failure.message, response.status, failure.detail);
  }
  if (payload === null) {
    throw new HubClientError(
      HUB_CLIENT_ERROR_CODES.invalidResponse,
      `中继 ${target.pathname} 回了无法解析的响应`,
      response.status,
      `响应无法解析（HTTP ${response.status}）`,
    );
  }
  return payload;
};

const invalid = (message: string): HubClientError =>
  new HubClientError(HUB_CLIENT_ERROR_CODES.invalidResponse, message);

/** 登录中继：用户名 + 密码换取令牌（管理端与客户端账号都认，中继侧先查管理端） */
export const hubLogin = async (url: string, input: HubLoginInput): Promise<HubLoginResult> => {
  const payload = await callHub({ url, path: HUB_LOGIN_PATH, method: "POST", body: input });
  const record = recordOf(payload);
  const token = readString(record?.token);
  const user = recordOf(record?.user);
  if (!token || !user) throw invalid("中继登录响应缺少 token 或 user");

  return {
    token,
    expiresAt: readString(record?.expiresAt),
    user: {
      id: readString(user.id) ?? "",
      username: readString(user.username) ?? input.username,
      type: readString(user.type) ?? "client",
    },
  };
};

/** 登记本机为设备：中继按「同一账号下的同名设备」去重，重复登记即轮换设备令牌 */
export const hubRegisterDevice = async (
  url: string,
  token: string,
  input: HubRegisterDeviceInput,
): Promise<HubRegisterDeviceResult> => {
  const payload = await callHub({
    url,
    path: HUB_DEVICE_REGISTER_PATH,
    method: "POST",
    token,
    body: input,
  });
  const record = recordOf(payload);
  const device = toHubDevice(record?.device);
  const deviceToken = readString(record?.token);
  if (!device || !deviceToken) throw invalid("中继登记响应缺少 device 或 token");

  return { device, token: deviceToken };
};

/** 吊销设备：中继侧令牌立即失效，本机在登出时顺手调它（失败也不阻本机解绑） */
export const hubRevokeDevice = async (
  url: string,
  token: string,
  id: string,
): Promise<HubDevice> => {
  const payload = await callHub({
    url,
    path: HUB_DEVICE_REVOKE_PATH,
    method: "POST",
    token,
    body: { id },
  });
  const device = toHubDevice(recordOf(payload)?.device);
  if (!device) throw invalid("中继吊销响应缺少 device");

  return device;
};
