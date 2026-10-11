/**
 * 编辑历史的编辑点校验：只允许编辑当前活动分支上的用户消息。
 *
 * 编辑走 pi 的 `navigateTree`（把叶子移回该消息父节点再重发），被放弃的旧分支留在会话文件里；
 * 因此编辑点必须在活动分支上，否则会把叶子切到别的分支、复活旧内容。
 * 抽成纯函数便于单测。
 */
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { ERROR_CODES } from "@ucode/contracts";

import { AppError } from "../../../platform/response";

export const resolveEditableUserEntry = (
  branch: readonly SessionEntry[],
  entryId: string,
): SessionMessageEntry => {
  const entry = branch.find((item) => item.id === entryId);
  if (!entry) {
    throw new AppError(ERROR_CODES.invalidRequest, "消息不存在或不在当前分支", 400);
  }
  if (entry.type !== "message" || entry.message.role !== "user") {
    throw new AppError(ERROR_CODES.invalidRequest, "只能编辑用户消息", 400);
  }
  return entry;
};
