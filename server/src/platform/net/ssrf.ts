/**
 * 出网目标的准入（SSRF 守卫）：只放行解析到公网地址的 http(s) 链接。
 *
 * 工具层（webfetch）与插件市场 / 包拉取共用这一份；`publicFetch` 会在每一跳重定向上再走一遍。
 *
 * 挡住的是 SSRF 的常见落点——回环、私网、链路本地（含云元数据 169.254.169.254）、
 * 多播与保留段；域名先解析再判，重定向的每一跳都要重新过一遍（见 webfetch 的跳转循环）。
 * 已知缺口：解析与真正建连之间有窗口，挡不住 DNS rebinding——但能指挥 agent 的人本来就有本机权限，
 * 这里要防的是「模型被提示注入后乱抓内网」这类盲打。
 */
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** 目标不可抓取：链接非法、协议不支持或落在受限网段 */
export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedTargetError";
  }
}

/**
 * 受限网段（IPv4 与 IPv6 各一份；`::ffff:` 映射写法由 BlockList 按 IPv4 规则匹配）。
 *
 * 口径：只拦「**别人能拿来打内网**」的段（回环 / 私网 / 链路本地 / CGNAT / ULA / 云元数据）
 * 与「**根本不是单播**」的段（多播 / 保留）。
 * 文档段（192.0.2.0/24、198.51.100.0/24、203.0.113.0/24）与基准测试段（198.18.0.0/15）**故意不拦**：
 * 它们不对应任何真实服务，而部分环境的 DNS 代理 / VPN 恰恰把公网域名解析到那里——
 * 实测 OrbStack 的 DNS 把 pi.dev / github.com 全映射到 198.18.0.x，拦掉等于让 webfetch 无法抓任何网页。
 * （DNS 被代理的环境里，这里拿到的本来就是代理地址而不是真实目标；域名级准入在那种环境下由代理兜底，
 * 不属于这层的责任范围——比较明确的回环 / 私网 / 元数据字面量仍照拦不误。）
 */
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // 本网络
  ["10.0.0.0", 8], // 私网
  ["100.64.0.0", 10], // 运营商级 NAT
  ["127.0.0.0", 8], // 回环
  ["169.254.0.0", 16], // 链路本地：AWS / GCP / Azure 的元数据端点都在这里
  ["172.16.0.0", 12], // 私网
  ["192.168.0.0", 16], // 私网
  ["224.0.0.0", 4], // 多播
  ["240.0.0.0", 4], // 保留（含 255.255.255.255）
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // 未指定
  ["::1", 128], // 回环
  // NAT64：内嵌 IPv4 的映射段。这里整段拦下（含 `64:ff9b::7f00:1` 这种指向网关回环的写法）；
  // 代价是 NAT64 网络上的公网目标也会被拒——要支持就得把内嵌的 IPv4 解出来单独判，先不做
  ["64:ff9b::", 96],
  ["100::", 64], // 丢弃前缀
  ["fc00::", 7], // 唯一本地地址
  ["fe80::", 10], // 链路本地
  ["ff00::", 8], // 多播
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

const parse = (raw: string): URL => {
  try {
    return new URL(raw.trim());
  } catch {
    throw new BlockedTargetError(`不是合法的链接：${raw}`);
  }
};

const assertAllowedAddress = (address: string, ipv6: boolean): void => {
  if (blocked.check(address, ipv6 ? "ipv6" : "ipv4")) {
    throw new BlockedTargetError(`目标地址落在受限网段，已拒绝：${address}`);
  }
};

/**
 * 校验并返回可抓取的目标；协议不是 http(s) 或地址不是公网时抛 `BlockedTargetError`。
 * 传 `URL` 时用于重定向后的下一跳，传字符串时先按链接解析。
 */
export const assertPublicUrl = async (target: string | URL): Promise<URL> => {
  const url = target instanceof URL ? target : parse(target);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedTargetError(`只允许 http/https 链接，当前为 ${url.protocol}`);
  }

  // URL.hostname 对 IPv6 字面量带方括号，去掉后再判是不是 IP
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new BlockedTargetError("链接缺少主机名");

  const family = isIP(hostname);
  if (family !== 0) {
    assertAllowedAddress(hostname, family === 6);
    return url;
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BlockedTargetError(`无法解析主机名：${hostname}`);
  }
  if (addresses.length === 0) throw new BlockedTargetError(`无法解析主机名：${hostname}`);
  for (const address of addresses) {
    assertAllowedAddress(address.address, address.family === 6);
  }
  return url;
};
