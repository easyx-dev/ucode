/** 中继 HTTP 调用：状态码 / 文案映射、设备结构映射、请求装配（URL、鉴权头、请求体） */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  HUB_CLIENT_ERROR_CODES,
  hubFailureOf,
  hubLogin,
  hubRegisterDevice,
  hubRevokeDevice,
  toHubDevice,
} from "../client";

describe("hubFailureOf", () => {
  it("401 / 403 归为凭证失效，429 归为限流，其余归为被拒", () => {
    assert.equal(hubFailureOf(401, {}).code, HUB_CLIENT_ERROR_CODES.unauthorized);
    assert.equal(hubFailureOf(403, {}).code, HUB_CLIENT_ERROR_CODES.unauthorized);
    assert.equal(hubFailureOf(429, {}).code, HUB_CLIENT_ERROR_CODES.rateLimited);
    assert.equal(hubFailureOf(400, {}).code, HUB_CLIENT_ERROR_CODES.rejected);
    assert.equal(hubFailureOf(500, {}).code, HUB_CLIENT_ERROR_CODES.rejected);
  });

  it("中继的 { error } 文案优先，拿不到才用状态码兜底", () => {
    assert.equal(
      hubFailureOf(401, { error: "未认证或凭证无效" }).message,
      "中继返回 401：未认证或凭证无效",
    );
    assert.equal(hubFailureOf(404, null).message, "中继返回 404");
    assert.equal(hubFailureOf(404, { error: "" }).message, "中继返回 404");
    assert.equal(hubFailureOf(404, "not-json").message, "中继返回 404");
  });
});

describe("toHubDevice", () => {
  it("缺 id 视为认不出的响应", () => {
    assert.equal(toHubDevice(null), null);
    assert.equal(toHubDevice({ name: "办公室 Mac" }), null);
    assert.equal(toHubDevice({ id: "" }), null);
  });

  it("可选字段缺失时给中性默认值", () => {
    const device = toHubDevice({ id: "device-1" });

    assert.deepEqual(device, {
      id: "device-1",
      name: "device-1",
      platform: null,
      clientVersion: null,
      status: "active",
      online: false,
      lastSeenAt: null,
      createdAt: null,
    });
  });

  it('online 只认真正的 true，避免字符串 "false" 被当成在线', () => {
    assert.equal(toHubDevice({ id: "d", online: "true" })?.online, false);
    assert.equal(toHubDevice({ id: "d", online: true })?.online, true);
  });
});

/** 记录调用参数的 fetch 替身：只替全局 fetch，不起任何服务 */
const stubFetch = (handler: (url: URL, init: RequestInit) => Response): (() => void) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(
      new URL(input instanceof Request ? input.url : String(input)),
      init ?? {},
    )) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
});

describe("hubLogin", () => {
  it("拼出绝对路径、带 JSON 体，并把令牌与账号解出来", async () => {
    const seen: Array<{ url: URL; init: RequestInit }> = [];
    restores.push(
      stubFetch((url, init) => {
        seen.push({ url, init });
        return json({
          token: "jwt-token",
          expiresAt: "2026-02-01T00:00:00.000Z",
          user: { id: "client-1", username: "bob", type: "client" },
        });
      }),
    );

    const result = await hubLogin("https://hub.example.com/", {
      username: "bob",
      password: "secret",
    });

    assert.equal(seen[0]?.url.href, "https://hub.example.com/api/v1/auth/login");
    assert.equal(seen[0]?.init.method, "POST");
    assert.equal(seen[0]?.init.body, JSON.stringify({ username: "bob", password: "secret" }));
    assert.deepEqual(result, {
      token: "jwt-token",
      expiresAt: "2026-02-01T00:00:00.000Z",
      user: { id: "client-1", username: "bob", type: "client" },
    });
  });

  it("响应缺 token 时报「认不出的响应」", async () => {
    restores.push(stubFetch(() => json({ user: { id: "client-1" } })));

    await assert.rejects(
      () => hubLogin("https://hub.example.com", { username: "bob", password: "x" }),
      (error: Error & { code?: string }) => error.code === HUB_CLIENT_ERROR_CODES.invalidResponse,
    );
  });

  it("非 2xx 抛带中继文案的错误，并带上状态码", async () => {
    restores.push(stubFetch(() => json({ error: "未认证或凭证无效" }, 401)));

    await assert.rejects(
      () => hubLogin("https://hub.example.com", { username: "bob", password: "x" }),
      (error: Error & { code?: string; status?: number | null }) =>
        error.code === HUB_CLIENT_ERROR_CODES.unauthorized &&
        error.status === 401 &&
        error.message === "中继返回 401：未认证或凭证无效",
    );
  });

  it("连不上时归为 unreachable 并带上地址", async () => {
    restores.push(
      stubFetch(() => {
        throw new Error("fetch failed");
      }),
    );

    await assert.rejects(
      () => hubLogin("https://hub.example.com", { username: "bob", password: "x" }),
      (error: Error & { code?: string }) =>
        error.code === HUB_CLIENT_ERROR_CODES.unreachable &&
        error.message.includes("https://hub.example.com"),
    );
  });
});

describe("设备接口", () => {
  it("登记带 Bearer 头，返回设备与一次性令牌", async () => {
    let headers: Record<string, string> = {};
    restores.push(
      stubFetch((url, init) => {
        headers = (init.headers ?? {}) as Record<string, string>;
        assert.equal(url.pathname, "/api/v1/devices/register");
        return json({ device: { id: "device-1", name: "办公室 Mac" }, token: "plain-token" });
      }),
    );

    const result = await hubRegisterDevice("https://hub.example.com", "jwt-token", {
      name: "办公室 Mac",
      platform: "darwin",
      clientVersion: "0.3.0",
    });

    assert.equal(headers.authorization, "Bearer jwt-token");
    assert.equal(result.token, "plain-token");
    assert.equal(result.device.id, "device-1");
  });

  it("中继地址带路径前缀时前缀保留（挂在反代子路径下的部署）", async () => {
    const seen: URL[] = [];
    restores.push(
      stubFetch((target) => {
        seen.push(target);
        return json({ token: "jwt-token", user: { id: "client-1", username: "bob" } });
      }),
    );

    await hubLogin("https://hub.example.com/relay/", { username: "bob", password: "secret" });

    assert.equal(seen[0]?.href, "https://hub.example.com/relay/api/v1/auth/login");
  });

  it("吊销用 POST + { id }，返回设备", async () => {
    let body: unknown = null;
    restores.push(
      stubFetch((_url, init) => {
        body = JSON.parse(String(init.body));
        return json({ device: { id: "device-1", status: "revoked" } });
      }),
    );

    const device = await hubRevokeDevice("https://hub.example.com", "jwt-token", "device-1");

    assert.deepEqual(body, { id: "device-1" });
    assert.equal(device.status, "revoked");
  });
});
