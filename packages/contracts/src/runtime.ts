/** ModelRuntime 的运行状态，供 health / models / config 三类接口复用 */
import type { ThinkingLevel } from "./constants";

export type RuntimeStatus = {
  /** 是否已有可用模型 */
  configured: boolean;
  /** 实际生效的 "provider/model" */
  defaultModel: string | null;
  /** 生效的 thinking 档位 */
  thinkingLevel: ThinkingLevel;
  /** 未就绪时的原因说明 */
  error: string | null;
};
