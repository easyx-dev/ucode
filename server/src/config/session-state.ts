/** 会话级覆盖（名称 / 工作目录 / 模型 / thinking level）的持久化 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { THINKING_LEVELS } from "@ucode/contracts";
import { z } from "zod";

import { env } from "../env";

const sessionOverrideSchema = z.object({
  /** 未落盘（还没有 assistant 回复）时的会话名兜底 */
  name: z.string().min(1).optional(),
  /** 新建会话时指定的工作目录 */
  cwd: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

const sessionStateSchema = z.record(z.string(), sessionOverrideSchema);

export type SessionOverride = z.infer<typeof sessionOverrideSchema>;

/** 每个会话的模型 / thinking 覆盖（pi 的 transcript 只记录变更，这里记录当前生效值） */
export class SessionStateStore {
  private state: Record<string, SessionOverride> = {};

  constructor(private readonly path: string = env.sessionStatePath) {}

  load(): void {
    if (!existsSync(this.path)) return;
    try {
      this.state = sessionStateSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      this.state = {};
    }
  }

  get(sessionId: string): SessionOverride {
    return this.state[sessionId] ?? {};
  }

  set(sessionId: string, override: SessionOverride): void {
    this.state[sessionId] = { ...this.get(sessionId), ...override };
    this.persist();
  }

  delete(sessionId: string): void {
    delete this.state[sessionId];
    this.persist();
  }

  private persist(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    renameSync(tmp, this.path);
  }
}
