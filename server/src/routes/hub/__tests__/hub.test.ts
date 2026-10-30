/**
 * /api/v1/hub 路由：状态透出、登录的地址兜底与中继失败映射、登出。
 *
 * 中继客户端与隧道都不参与：`services.hub` 用替身，只验路由层对它的编排与失败封套
 * （真实调用的映射在 `services/hub/__tests__` 里各自验过）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { API_BASE_PATH, ERROR_CODES, type HubStatusResponse } from "@ucode/contracts";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, fail } from "../../../platform/response";
import type { Services } from "../../../services";
import { HUB_CLIENT_ERROR_CODES, HubClientError } from "../../../services/hub/client";
import { createHubRoute } from "..";

const CONNECTED: HubStatusResponse = {
  configured: true,
  url: "https://relay.example.com",
  username: "owner",
  deviceId: "device-1",
  deviceName: "dev-mac",
  running: true,
  runtime: {
    connected: true,
    connectedAt: "2026-10-20T03:00:00.000Z",
    lastError: null,
    reconnectAttempt: 0,
  },
};

type LoginCall = { url?: string; username: string; password: string };

/** 登录替身：默认按传入地址回一份「已接入」状态，可换成抛特定中继错误 */
const makeApp = (options: { url?: string | null; login?: (input: LoginCall) => void } = {}) => {
  const logins: LoginCall[] = [];
  let logoutCount = 0;

  const hub = {
    getStatus: (): HubStatusResponse => ({
      ...CONNECTED,
      url: options.url === undefined ? CONNECTED.url : options.url,
    }),
    login: async (input: LoginCall): Promise<HubStatusResponse> => {
      logins.push(input);
      options.login?.(input);
      return { ...CONNECTED, url: input.url ?? null, username: input.username };
    },
    logout: (): HubStatusResponse => {
      logoutCount += 1;
      return { ...CONNECTED, configured: false, username: null, deviceId: null, running: false };
    },
  };

  const app = new Hono();
  app.route(`${API_BASE_PATH}/hub`, createHubRoute({ hub } as unknown as Services));
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        fail(error.code, error.message, error.details, error.params),
        error.status as ContentfulStatusCode,
      );
    }
    throw error;
  });
  return { app, logins, logoutCount: () => logoutCount };
};

type Failure = { code: string; message: string; params?: Record<string, string> };

const post = (app: Hono, action: string, body: unknown) =>
  app.request(`${API_BASE_PATH}/hub/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const login = async (
  app: Hono,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Failure & { data: HubStatusResponse } }> => {
  const response = await post(app, "login", body);
  return { status: response.status, payload: (await response.json()) as never };
};

describe("/api/v1/hub/status", () => {
  it("透出中继服务层的状态", async () => {
    const { app } = makeApp();
    const response = await app.request(`${API_BASE_PATH}/hub/status`);

    assert.equal(response.status, 200);
    const payload = (await response.json()) as { data: HubStatusResponse };
    assert.deepEqual(payload.data, { ...CONNECTED, url: CONNECTED.url });
  });
});

describe("/api/v1/hub/login", () => {
  it("用请求给的地址登录，去掉两端空白后转给服务层", async () => {
    const { app, logins } = makeApp();
    const { status, payload } = await login(app, {
      url: "  https://relay.example.com  ",
      username: "owner",
      password: "secret",
    });

    assert.equal(status, 200);
    assert.equal(payload.data.username, "owner");
    assert.deepEqual(logins, [
      { url: "https://relay.example.com", username: "owner", password: "secret" },
    ]);
  });

  it("省略地址时用本机已存的那份", async () => {
    const { app, logins } = makeApp();
    await login(app, { username: "owner", password: "secret" });

    assert.equal(logins[0]?.url, CONNECTED.url);
  });

  it("没有地址可用时给「未配置中继地址」，不落到服务层的普通 Error", async () => {
    const { app, logins } = makeApp({ url: null });
    const { status, payload } = await login(app, { username: "owner", password: "secret" });

    assert.equal(status, 400);
    assert.equal(payload.code, ERROR_CODES.hubNotConfigured);
    assert.deepEqual(logins, []);
  });

  it("缺账号或密码时按请求校验失败拦下", async () => {
    const { app } = makeApp();
    const response = await post(app, "login", { username: "owner" });
    const payload = (await response.json()) as Failure;

    assert.equal(response.status, 400);
    assert.equal(payload.code, ERROR_CODES.invalidRequest);
  });

  it("中继侧失败按 code 映射错误码与状态，并带上中文明细供客户端插值", async () => {
    const cases: Array<{ raise: () => void; code: string; status: number }> = [
      {
        raise: () => {
          throw new HubClientError(
            HUB_CLIENT_ERROR_CODES.unreachable,
            "无法连接中继 https://relay.example.com：fetch failed",
          );
        },
        code: ERROR_CODES.hubUnreachable,
        status: 502,
      },
      {
        raise: () => {
          throw new HubClientError(
            HUB_CLIENT_ERROR_CODES.unauthorized,
            "中继返回 401：密码错误",
            401,
          );
        },
        code: ERROR_CODES.hubLoginFailed,
        status: 401,
      },
      {
        raise: () => {
          throw new HubClientError(HUB_CLIENT_ERROR_CODES.rateLimited, "中继返回 429", 429);
        },
        code: ERROR_CODES.rateLimited,
        status: 429,
      },
      {
        raise: () => {
          throw new HubClientError(HUB_CLIENT_ERROR_CODES.rejected, "中继返回 500", 500);
        },
        code: ERROR_CODES.hubRegisterFailed,
        status: 500,
      },
      {
        raise: () => {
          throw new HubClientError(
            HUB_CLIENT_ERROR_CODES.invalidResponse,
            "中继 /api/v1/devices/register 回了无法解析的响应",
            200,
          );
        },
        code: ERROR_CODES.hubRegisterFailed,
        status: 500,
      },
    ];

    for (const item of cases) {
      const { app } = makeApp({ login: item.raise });
      const { status, payload } = await login(app, { username: "owner", password: "secret" });

      assert.equal(status, item.status, `${item.code} 的状态码`);
      assert.equal(payload.code, item.code);
      assert.equal(payload.params?.url, CONNECTED.url);
      assert.equal(typeof payload.params?.reason, "string");
    }
  });
});

describe("/api/v1/hub/logout", () => {
  it("解绑本机并返回解绑后的状态", async () => {
    const { app, logoutCount } = makeApp();
    const response = await post(app, "logout", {});
    const payload = (await response.json()) as { data: HubStatusResponse };

    assert.equal(response.status, 200);
    assert.equal(logoutCount(), 1);
    assert.equal(payload.data.configured, false);
    assert.equal(payload.data.running, false);
  });
});
