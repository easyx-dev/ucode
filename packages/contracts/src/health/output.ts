/** health / info / status 三个接口的响应模型：存活、发现与认证后的运行时状态分开 */
import type { RuntimeStatus } from "../runtime";

/**
 * 存活探针的最小响应：不泄露模型 / 配置。
 * 未认证也能访问，只用于「服务是否在跑」。
 */
export type HealthMinimalResponse = {
  up: boolean;
  /** 服务端版本（根 package.json 的 version） */
  version: string;
};

/**
 * 服务发现与版本兼容：未认证可访问，供客户端判断「能否连这个服务」。
 * 字段口径见 plans/service-and-auth.md §4。
 */
export type ServerInfoResponse = {
  /** 服务端版本 */
  version: string;
  /** 接口契约版本（与 API_BASE_PATH 同源） */
  apiVersion: string;
  /** 本服务可被哪些客户端版本使用，semver range 字符串（如 `^0.2.0`） */
  compatRange: string;
};

/** 认证后的运行时状态（原 HealthResponse 的富载荷） */
export type StatusResponse = RuntimeStatus & {
  /** 助理根目录：未绑定工作目录的会话，工作区是它下面以会话 id 命名的那层 */
  workspace: string;
  /** 内存中驻留的 AgentSession 数 */
  activeSessions: number;
  /** 进程已运行时长 */
  uptimeMs: number;
};
