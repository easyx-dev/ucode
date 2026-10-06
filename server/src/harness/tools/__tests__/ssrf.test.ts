/** 目标准入单测：SSRF 常见落点必须被拦下（对应阶段 1 的 W-01 / W-02 / W-04） */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertPublicUrl, BlockedTargetError } from "../ssrf";

describe("assertPublicUrl", () => {
  it("拒绝回环地址（含 IPv4 映射写法）", async () => {
    await assert.rejects(assertPublicUrl("http://127.0.0.1:2048/"), BlockedTargetError);
    await assert.rejects(assertPublicUrl("http://[::1]/"), BlockedTargetError);
    await assert.rejects(assertPublicUrl("http://[::ffff:127.0.0.1]/"), BlockedTargetError);
  });

  it("拒绝云元数据所在的链路本地段", async () => {
    await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data/"));
  });

  it("拒绝私网 / 唯一本地地址", async () => {
    await assert.rejects(assertPublicUrl("http://10.1.2.3/"));
    await assert.rejects(assertPublicUrl("http://172.16.0.1/"));
    await assert.rejects(assertPublicUrl("http://192.168.1.1/"));
    await assert.rejects(assertPublicUrl("http://[fd00::1]/"));
  });

  it("放行私网段边界外的地址", async () => {
    assert.equal((await assertPublicUrl("http://172.32.0.1/")).hostname, "172.32.0.1");
    assert.equal((await assertPublicUrl("https://93.184.216.34/")).hostname, "93.184.216.34");
  });

  it("放行基准测试段：部分环境的 DNS 代理就把公网域名映射到这里", async () => {
    // OrbStack / 一些 VPN 会把所有域名解析到 198.18.0.0/15，拦掉等于 webfetch 抓不了任何网页
    assert.equal((await assertPublicUrl("https://198.18.0.157/")).hostname, "198.18.0.157");
    assert.equal((await assertPublicUrl("https://198.19.255.254/")).hostname, "198.19.255.254");
  });

  it("域名按解析结果判定", async () => {
    // 走 /etc/hosts，不需要真实网络
    await assert.rejects(assertPublicUrl("http://localhost/"), BlockedTargetError);
  });

  it("拒绝非 http(s) 协议与非法链接", async () => {
    await assert.rejects(assertPublicUrl("file:///etc/passwd"), /只允许 http\/https/);
    await assert.rejects(assertPublicUrl("ftp://example.com/"), /只允许 http\/https/);
    await assert.rejects(assertPublicUrl("不是链接"), /不是合法的链接/);
  });
});
