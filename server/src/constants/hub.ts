/**
 * 中继（hub）的接口路径、来源头与运行参数，以及把它注入成本机 provider 时用的固定标识。
 *
 * 三个来源标记由中继客户端在转发时注入，只进请求日志与统计，**不参与鉴权**
 * （见 `docs/api.md`「传输约定」）。
 */

/** 请求来自哪条通道：`tunnel` 表示经中继；本地调用不带 */
export const HUB_SOURCE_HEADER = "x-hub-source";

/** 本实例在中继上的设备标识 */
export const HUB_DEVICE_HEADER = "x-hub-device";

/** 发起方的客户端标识（由中继侧给出） */
export const HUB_CLIENT_HEADER = "x-hub-client";

/**
 * 本页面被挂在哪段路径前缀下（如 `/d/<设备 id>`）。
 * 中继按路径访问设备时注入，服务端据此改写 `index.html` 的 `<base href>`——页面里的相对资源
 * 必须按这个前缀解析，否则会落到中继自己的 `/assets/*`。与来源标记同理，不参与鉴权。
 */
export const HUB_BASE_PATH_HEADER = "x-hub-base-path";

/** 中继的接口路径（都在它的 `/api/v1` 下）：登录换令牌，登记 / 吊销本机设备 */
export const HUB_LOGIN_PATH = "/api/v1/auth/login";
export const HUB_DEVICE_REGISTER_PATH = "/api/v1/devices/register";
export const HUB_DEVICE_REVOKE_PATH = "/api/v1/devices/revoke";

/** 换隧道票据：设备令牌换一张短时票据，隧道握手只认票据（见 hub 的 `tunnel-ticket.server`） */
export const HUB_TUNNEL_TICKET_PATH = "/api/v1/devices/tunnel-ticket";

/** 中继 HTTP 调用（登录与设备接口）的单次超时：登录要连带查库与比对 bcrypt，比内网接口慢 */
export const HUB_HTTP_TIMEOUT_MS = 15_000;

/** 中继模型端点的根路径：对话与模型清单都在它下面（`/v1/chat/completions`、`/v1/models`） */
export const HUB_MODEL_API_PATH = "/v1";

/** 中继 provider 的固定 id：幂等按它认，也是模型设置里看到的供应商 id */
export const HUB_PROVIDER_ID = "relay";

/** 中继 provider 的展示名 */
export const HUB_PROVIDER_NAME = "中继";

/** 内置资产的接口路径（中继侧实现见 hub/docs/builtin-assets.md）：清单与内容 */
export const HUB_BUILTIN_MANIFEST_PATH = "/builtin/manifest";
export const HUB_BUILTIN_ASSET_PATH_PREFIX = "/builtin/assets/";

/** 内置资产拉取的超时：一个技能目录可能带若干参考资料，比登录接口宽松一档 */
export const HUB_BUILTIN_TIMEOUT_MS = 30_000;

/**
 * 握手的应答上限：WS 连上了但对端不接话（半个中继进程、被反代挂住）时不能一直挂着，
 * 超时即按连接失败处理（断开重连）。
 */
export const HUB_HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * 本机以非 101 拒绝 WebSocket 升级时，回给浏览器的关闭码按 HTTP 状态映射：
 * 401 → 凭证失效、404 → 目标已不存在（与终端的关闭码约定对齐），其余按内部错误。
 * 不映射的话浏览器只剩「连接异常」，终端这类靠关闭码区分终态的场景会一直重连。
 */
export const HUB_UPGRADE_REJECT_CLOSE_CODES: Record<number, number> = { 401: 4401, 404: 4404 };

/** 重连退避：首次延迟、逐次翻倍后的上限、以及抖动比例 */
export const HUB_RECONNECT_BASE_MS = 1_000;
export const HUB_RECONNECT_MAX_MS = 30_000;
export const HUB_RECONNECT_JITTER_RATIO = 0.2;
