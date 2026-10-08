/**
 * 项目级记忆（Memory）的装配入口：索引注入、remember / forget 工具、会话落定后的自动回顾。
 *
 * 记忆按会话工作目录归属（见 `paths.ts`），设置开关来自 config（`memory.enabled`）。
 * 自动回顾是纯后台动作：不阻塞本轮、失败只记日志，且同一会话同一时间只跑一次，
 * 避免连续两轮各起一次回顾同时改索引。
 */
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { MEMORY_REVIEW_RECORD_CUSTOM_TYPE, type MemoryConfig } from "@ucode/contracts";

import { MEMORY_INDEX_MAX_CHARS } from "../../constants";
import { env } from "../../env";
import { logger } from "../../lib/logger";
import { memoryIndexPath } from "./paths";
import { extractExchange, runMemoryReview, shouldReview } from "./review";
import { readIndexText } from "./store";
import { createMemoryTools } from "./tools";

export class MemoryService {
  private readonly reviewing = new Set<string>();

  constructor(
    private readonly settings: () => MemoryConfig,
    private readonly appDir: string = env.appDir,
  ) {}

  get enabled(): boolean {
    return this.settings().enabled;
  }

  /** 供 resourceLoader 注入的索引文件；未开启、无条目时返回 null */
  indexFile(cwd: string): { path: string; content: string } | null {
    if (!this.enabled) return null;
    const content = readIndexText(cwd, this.appDir);
    if (!content) return null;
    return {
      path: memoryIndexPath(cwd, this.appDir),
      content:
        content.length > MEMORY_INDEX_MAX_CHARS
          ? `${content.slice(0, MEMORY_INDEX_MAX_CHARS)}\n…（索引过长已截断）`
          : content,
    };
  }

  /** build 模式的记忆工具；未开启时返回空数组 */
  tools(cwd: string): ToolDefinition[] {
    return this.enabled ? createMemoryTools(cwd, this.appDir) : [];
  }

  /** 会话落定后异步回顾最近交流，不阻塞调用方 */
  review(sessionId: string, session: AgentSession): void {
    if (!this.enabled || this.reviewing.has(sessionId)) return;
    if (!shouldReview(session.messages)) return;
    const model = session.model;
    if (!model) return;
    const turns = extractExchange(session.messages);
    if (turns.length === 0) return;

    const cwd = session.sessionManager.getCwd();
    this.reviewing.add(sessionId);
    void runMemoryReview({
      runtime: session.modelRuntime,
      model,
      cwd,
      appDir: this.appDir,
      turns,
      record: (saved) => {
        try {
          session.sessionManager.appendCustomEntry(MEMORY_REVIEW_RECORD_CUSTOM_TYPE, {
            ...saved,
            at: new Date().toISOString(),
          });
        } catch (error) {
          logger.warn({ sessionId, error }, "记忆回顾记录写入失败");
        }
      },
    })
      .catch((error: unknown) => logger.warn({ sessionId, error }, "记忆回顾失败"))
      .finally(() => this.reviewing.delete(sessionId));
  }

  /** 会话回收时丢弃进行中标记；已在途的回顾会自然跑完 */
  discardReview(sessionId: string): void {
    this.reviewing.delete(sessionId);
  }
}
