/**
 * 会话文件里的「运行参数」审计点：模式与权限档位的最后一条记录。
 *
 * 只写不读。模式与权限档位的真值只有 `app.db`（写入方只有应用侧：新建时定初始值，
 * 之后只有 `PATCH /sessions/update`）；
 * 会话文件是**审计事实**——它记着「这一轮跑在什么参数下」，但不参与回写应用状态：
 * 写点天然滞后于用户切换（切了还没跑），拿文件回写库等于给同一份值开两个真值源，
 * 顺序反过来一次就会把刚做的切换吞掉。这里只留「取最后一条设置点」供写侧去重
 * （`hasRunSettingsChanged`）。
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { MODE_RECORD_CUSTOM_TYPE } from "@ucode/contracts";

import { modeRecordOf } from "./serialize";

/** 一条设置点里真正生效的那部分；两个字段都可能缺（只切了其中一个） */
export type RunSettings = {
  mode?: string;
  permissionMode?: string;
};

/**
 * 这一轮的参数与文件里最后一条设置点是否不同——决定要不要再记一条。
 *
 * 去重对着文件而不是内存：实例重装（重启 / 换模型 / 换权限档位都会 dispose）后内存那份会重置，
 * 同一份参数每轮都被重记一条，消息区里于是反复出现「本轮参数」。
 */
export const hasRunSettingsChanged = (last: RunSettings | null, next: RunSettings): boolean => {
  if (!last) return true;
  return last.mode !== next.mode || last.permissionMode !== next.permissionMode;
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
