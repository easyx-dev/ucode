/**
 * 会话文件里的「运行参数」读回：模式与权限档位的最后一条记录。
 *
 * 写点在轮开始（`SessionPool.recordRunSettings`），这里是它的反方向——打开已有会话时用文件校准
 * `app.db`：JSONL 是会话的事实源，删库或把文件拷到别的实例后，模式不该悄悄回落成 `build`。
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { MODE_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { modeRecordOf } from "./serialize";

/** 一条设置点里真正生效的那部分；两个字段都可能缺（只切了其中一个） */
export type RunSettings = {
  mode?: string;
  permissionMode?: string;
};

/** 从条目里取最后一条设置点；没有（老会话 / 从未设置过）时返回 null */
export const lastRunSettingsOf = (entries: readonly SessionEntry[]): RunSettings | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== MODE_RECORD_CUSTOM_TYPE) continue;
    const record = modeRecordOf(entry.data);
    if (!record) continue;
    return {
      ...(record.mode !== undefined ? { mode: record.mode } : {}),
      ...(record.permissionMode !== undefined ? { permissionMode: record.permissionMode } : {}),
    };
  }
  return null;
};
