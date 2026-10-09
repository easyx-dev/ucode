/**
 * 会话文件里的「运行参数」读回：模式与权限档位的最后一条记录。
 *
 * 写点在轮开始（`SessionPool.recordRunSettings`），这里是它的反方向——打开已有会话时用它补上
 * `app.db` 里还没记过的列（建会话时没给模式 / 档位的行，见 `runSettingsPatch`）。
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { MODE_RECORD_CUSTOM_TYPE, PERMISSION_MODES, type PermissionMode } from "@ucode/contracts";

import type { SessionOverride } from "../db/session-repository";
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

/**
 * 由「文件里的设置点」与「库里记过的值」算出要回填的字段；返回 `null` 表示不用动。
 *
 * **只补库里没记过的列**（值为 `null`）：库里已有的值要么是用户刚切的、要么是建会话时定的，
 * 都比文件里最后一条记录新。切换模式 / 档位先写库、写文件要等这一轮开始，一旦反过来拿文件
 * 覆盖库，打开会话时正是「切了还没跑」的窗口，切换会被静默回退成上一轮的参数。
 *
 * 值不可用也不写：不认识的模式 slug（自定义角色可能已被删）、不合法的权限档位（文件可能被手改过）——
 * 写回一份用不了的值，会让别的读取方也跟着看到它。
 *
 * 于是这一侧实际只是兜底：够得着它的只有「建会话时没给模式 / 档位」的行，而写进文件的值取自库里的
 * 生效值（`runSettingsOf`，空列已是回落默认值），补回去的与读取方本来就会回落的默认值一致。
 */
export const runSettingsPatch = (
  recorded: RunSettings | null,
  // 库里记过的原值（可能为空或历史值），比较用不着先校验；写回的那侧才校验
  current: { mode: string | null; permissionMode: string | null },
  isKnownMode: (slug: string) => boolean,
): SessionOverride | null => {
  if (!recorded) return null;
  const patch: SessionOverride = {};
  if (recorded.mode !== undefined && current.mode === null && isKnownMode(recorded.mode)) {
    patch.mode = recorded.mode;
  }
  if (
    recorded.permissionMode !== undefined &&
    current.permissionMode === null &&
    (PERMISSION_MODES as readonly string[]).includes(recorded.permissionMode)
  ) {
    patch.permissionMode = recorded.permissionMode as PermissionMode;
  }
  return Object.keys(patch).length > 0 ? patch : null;
};
