/** 端点判定与重连退避：地址 → 隧道端点，配置 → 能不能连，退避节奏 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HUB_RECONNECT_MAX_MS } from "../../../constants/hub";
import type { HubConfig } from "../config";
import { reconnectDelayMs, resolveEndpoint, toTunnelUrl } from "../endpoint";

const config = (patch: Partial<HubConfig>): HubConfig => ({
  enabled: true,
  url: "https://hub.example.com",
  deviceId: "device-1",
  deviceToken: "token-1",
  token: "session-token",
  username: "owner",
  ...patch,
});

describe("toTunnelUrl", () => {
  it("http → ws、https → wss，末尾斜杠不留下双斜杠", () => {
    assert.equal(toTunnelUrl("http://hub.example.com"), "ws://hub.example.com/api/v1/tunnel");
    assert.equal(toTunnelUrl("https://hub.example.com/"), "wss://hub.example.com/api/v1/tunnel");
  });

  it("保留非默认端口", () => {
    assert.equal(
      toTunnelUrl("https://hub.example.com:8443"),
      "wss://hub.example.com:8443/api/v1/tunnel",
    );
  });

  it("保留地址里的路径前缀（中继挂在反代子路径下时用得上）", () => {
    assert.equal(
      toTunnelUrl("https://example.com/relay/"),
      "wss://example.com/relay/api/v1/tunnel",
    );
  });

  it("非 http(s) 与非法地址返回 null", () => {
    assert.equal(toTunnelUrl("hub.example.com"), null);
    assert.equal(toTunnelUrl("ftp://hub.example.com"), null);
    assert.equal(toTunnelUrl(""), null);
  });
});

describe("resolveEndpoint", () => {
  it("未启用就是 idle：没有可连的东西，也不是失败", () => {
    assert.deepEqual(resolveEndpoint(config({ enabled: false })), { kind: "idle" });
  });

  it("缺地址、缺设备令牌、地址形态非法都给出可显示的原因", () => {
    const noUrl = resolveEndpoint(config({ url: null }));
    assert.equal(noUrl.kind, "unusable");
    assert.match(noUrl.kind === "unusable" ? noUrl.reason : "", /中继地址/);

    const noToken = resolveEndpoint(config({ deviceToken: null }));
    assert.equal(noToken.kind, "unusable");
    assert.match(noToken.kind === "unusable" ? noToken.reason : "", /登记本机设备/);

    const badUrl = resolveEndpoint(config({ url: "hub.example.com" }));
    assert.equal(badUrl.kind, "unusable");
    assert.match(badUrl.kind === "unusable" ? badUrl.reason : "", /不是合法的 http\(s\) 地址/);
  });

  it("齐备时给出端点与设备凭证（设备 id 只为日志，缺席也能连）", () => {
    assert.deepEqual(resolveEndpoint(config({})), {
      kind: "ready",
      endpoint: "wss://hub.example.com/api/v1/tunnel",
      deviceToken: "token-1",
      deviceId: "device-1",
    });
    assert.equal(resolveEndpoint(config({ deviceId: null })).kind, "ready");
  });
});

describe("reconnectDelayMs", () => {
  const mid = (): number => 0.5;

  it("逐次翻倍，封顶后不再增长", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 9].map((attempt) => reconnectDelayMs(attempt, mid));

    assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it("抖动落在 ±20% 内，且不会为负或为 0", () => {
    for (const random of [() => 0, () => 0.999, () => 0.25]) {
      for (const attempt of [0, 3, 7]) {
        const delay = reconnectDelayMs(attempt, random);
        const capped = Math.min(1_000 * 2 ** attempt, HUB_RECONNECT_MAX_MS);
        assert.ok(delay >= capped * 0.8 - 1, `${attempt} 次的下限`);
        assert.ok(delay <= capped * 1.2 + 1, `${attempt} 次的上限`);
        assert.ok(delay > 0);
      }
    }
  });
});
