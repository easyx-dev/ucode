/** health 接口的响应模型 */
import type { RuntimeStatus } from "../runtime";

export type HealthResponse = RuntimeStatus & {
  /** 接口版本标识 */
  version: string;
  /** agent 工作目录 */
  workspace: string;
  /** 内存中驻留的 AgentSession 数 */
  activeSessions: number;
  /** 进程已运行时长 */
  uptimeMs: number;
};
