/**
 * 从配置推出隧道端点与重连节奏：把「连不上」的原因判定收在一处，编排层只管按结论迁移阶段。
 *
 * 这里判定的是**能不能连**，不是「连得好不好」：地址缺失、未登记设备、地址形态非法都返回
 * `unusable` 并带中文原因（界面直接显示）。未启用返回 `idle`——没有可连的东西，也不是失败。
 */
import { TUNNEL_PATH } from "@ucode/hub-protocol";

import {
  HUB_RECONNECT_BASE_MS,
  HUB_RECONNECT_JITTER_RATIO,
  HUB_RECONNECT_MAX_MS,
} from "../../constants/hub";
import type { HubConfig } from "./config";

/** 端点判定：`ready` 才建连，另外两种只更新运行态 */
export type EndpointResolution =
  | { kind: "idle" }
  | { kind: "unusable"; reason: string }
  | { kind: "ready"; endpoint: string; deviceToken: string; deviceId: string | null };

/**
 * 中继地址 → 隧道端点。http→ws / https→wss，主机、端口与地址里的路径前缀都保留
 * （中继挂在反代的子路径下时用得上），端点固定是 `TUNNEL_PATH`。
 */
export const toTunnelUrl = (hubUrl: string): string | null => {
  let base: URL;
  try {
    base = new URL(hubUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;

  const scheme = base.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${base.host}${base.pathname.replace(/\/+$/, "")}${TUNNEL_PATH}`;
};

/** 按配置解析端点；`enabled` 是硬开关，关掉就不再连（与「缺配置」分开表达） */
export const resolveEndpoint = (config: HubConfig): EndpointResolution => {
  if (!config.enabled) return { kind: "idle" };
  if (!config.url) return { kind: "unusable", reason: "已开启中继但没有可用的中继地址" };
  if (!config.deviceToken) return { kind: "unusable", reason: "尚未在中继上登记本机设备" };

  const endpoint = toTunnelUrl(config.url);
  if (!endpoint) {
    return { kind: "unusable", reason: `中继地址不是合法的 http(s) 地址：${config.url}` };
  }
  return { kind: "ready", endpoint, deviceToken: config.deviceToken, deviceId: config.deviceId };
};

/**
 * 重连退避：第 n 次（从 0 起）延迟 = base × 2^n，封顶 max，再乘 1±jitter 的抖动。
 * 抖动是必要的——中继重启时所有客户端会在同一刻回连，整齐地涌上去只会让它再崩一次。
 */
export const reconnectDelayMs = (attempt: number, random: () => number = Math.random): number => {
  const capped = Math.min(HUB_RECONNECT_BASE_MS * 2 ** Math.max(attempt, 0), HUB_RECONNECT_MAX_MS);
  const jitter = 1 - HUB_RECONNECT_JITTER_RATIO + random() * HUB_RECONNECT_JITTER_RATIO * 2;
  return Math.round(capped * jitter);
};
