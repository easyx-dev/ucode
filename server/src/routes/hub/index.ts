/**
 * /api/v1/hub：中继（hub）的接入状态、登录、解绑，以及把它的模型端点写成本机 provider。
 *
 * 登录一次完成三件事：换令牌、把本机登记成设备、写回本机配置（都在服务层），隧道随之重建——
 * 所以响应就是登录后的状态本身。失败原因由 `HubClientError.code` 决定错误码与 HTTP 状态，
 * 中文明细随 `params.reason` 下发给客户端插值（服务端不做本地化）。
 */
import {
  ERROR_CODES,
  emptyInputSchema,
  type HubLoginInput,
  type HubLoginResponse,
  type HubLogoutResponse,
  type HubProviderResponse,
  type HubStatusResponse,
  hubLoginInputSchema,
  hubProviderInputSchema,
} from "@ucode/contracts";
import { Hono } from "hono";
import { AppError, ok } from "../../platform/response";
import { jsonBody } from "../../platform/validate";
import type { Services } from "../../services";
import {
  HUB_CLIENT_ERROR_CODES,
  HubClientError,
  type HubClientErrorCode,
} from "../../services/hub/client";

/**
 * 中继侧失败 → 本服务对外错误码与 HTTP 状态。
 * 状态码只表达传输层语义（客户端按 code 分支）：中继不可达是网关失败，凭证不被接受是未认证，
 * 其余（拒绝 / 响应认不出）都在登记设备这一段，按上游故障算。
 */
const HUB_FAILURES: Record<HubClientErrorCode, { code: string; status: number }> = {
  [HUB_CLIENT_ERROR_CODES.unreachable]: { code: ERROR_CODES.hubUnreachable, status: 502 },
  [HUB_CLIENT_ERROR_CODES.unauthorized]: { code: ERROR_CODES.hubLoginFailed, status: 401 },
  [HUB_CLIENT_ERROR_CODES.rateLimited]: { code: ERROR_CODES.rateLimited, status: 429 },
  [HUB_CLIENT_ERROR_CODES.rejected]: { code: ERROR_CODES.hubRegisterFailed, status: 500 },
  [HUB_CLIENT_ERROR_CODES.invalidResponse]: {
    code: ERROR_CODES.hubRegisterFailed,
    status: 500,
  },
};

export const createHubRoute = (services: Services) => {
  const router = new Hono();

  const statusOf = () => services.hub.getStatus();

  /**
   * 登录用的地址：请求给的优先，其次本机已存的那份（含部署预置缺省）。
   * 与登录时服务层的取值顺序一致，好让这里的地址缺失判定和它的抛错条件是同一件事。
   */
  const addressOf = (input: HubLoginInput): string => (input.url ?? statusOf().url ?? "").trim();

  const login = async (input: HubLoginInput) => {
    const url = addressOf(input);
    // 服务层拿不到地址时抛的是普通 Error；在这里先拦下，才能给出可渲染的中继错误码而不是 500
    if (!url) {
      throw new AppError(
        ERROR_CODES.hubNotConfigured,
        "未配置中继地址：请填写中继服务地址后再登录",
        400,
      );
    }

    try {
      return await services.hub.login({ ...input, url });
    } catch (error) {
      if (!(error instanceof HubClientError)) throw error;
      const failure = HUB_FAILURES[error.code];
      // reason 只传底层原因（如 fetch failed）：文案 key 自己带「无法连接中继 {{url}}」这类前缀
      throw new AppError(failure.code, error.message, failure.status, undefined, {
        url,
        reason: error.detail,
      });
    }
  };

  router.get("/status", (c) => c.json(ok(statusOf() satisfies HubStatusResponse)));

  router.post("/login", jsonBody(hubLoginInputSchema), async (c) =>
    c.json(ok((await login(c.req.valid("json"))) satisfies HubLoginResponse)),
  );

  router.post("/logout", jsonBody(emptyInputSchema), (c) =>
    c.json(ok(services.hub.logout() satisfies HubLogoutResponse)),
  );

  // 写中继 provider 的失败（缺地址 / 缺设备令牌 / 中继没有模型 / 端点调用失败）都由服务层抛
  // AppError 与错误码，与其余接口一样交给统一错误中间件
  router.post("/provider", jsonBody(hubProviderInputSchema), async (c) =>
    c.json(ok((await services.hub.addProvider()) satisfies HubProviderResponse)),
  );

  return router;
};
