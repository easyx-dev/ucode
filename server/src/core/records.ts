/**
 * 往会话文件追加只供回溯的观测记录（契约里 `*_RECORD_CUSTOM_TYPE` 那批 pi `custom` 条目）。
 *
 * 这些记录不进模型上下文、也不下发客户端，写入时机与顺序没有实时性要求。两条写入路径：
 * 会话在池里（正在跑）就用手上的 manager；已经回收的按 `source_path` 打开文件写。
 * 为什么不能一律按路径打开：`ensure()` 抓到的那份记录快照里 `source_path` 可能还是空的
 * （新会话首次落定前，索引还没回写），照它判断会把正要用的记录整条丢掉。
 * 写失败只记日志：观测不能影响主流程。
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionRecord } from "../db/session-repository";
import { env } from "../env";
import { resolveSessionCwd } from "../harness/session-config";
import { logger } from "../lib/logger";

export const appendSessionRecord = (
  record: SessionRecord | undefined,
  customType: string,
  data: Record<string, unknown>,
  /** 池里那个活会话的 manager；由调用点现取，省略则按文件路径打开 */
  live?: SessionManager,
): void => {
  if (!live && !record?.sourcePath) return;
  try {
    if (live) {
      live.appendCustomEntry(customType, data);
      return;
    }
    if (!record?.sourcePath) return;
    const manager = SessionManager.open(
      record.sourcePath,
      env.sessionsDir,
      resolveSessionCwd(record),
    );
    manager.appendCustomEntry(customType, data);
  } catch (error) {
    logger.warn({ error, sessionId: record?.id, customType }, "会话记录写入失败");
  }
};
