/**
 * 技能命中与显式调用的判定：一次工具调用是否读到了某个技能文件、一条输入是否就是 `/skill:name`。
 *
 * 纯函数，只依赖技能索引与会话 cwd——命中比对与显式调用共用同一份索引（见 `assets/index`），
 * 免得「界面列出的」「pi 认的」「记下来的」出现三份口径。
 */

import { normalizeSkillFile, type SkillIndex, type SkillIndexEntry } from "./";
import { SKILL_PATTERN } from "./expand";

/**
 * 一次工具调用是否读到了某个技能文件；命中返回那个技能，否则 null。
 *
 * 只认 `read`：pi 广告给模型的渠道就是「用 `read` 读该文件」（`<available_skills>` 的提示），
 * 按别的路径（`bash cat` / `grep`）猜会引入误报。
 */
export const matchSkillHit = (
  toolName: string,
  args: unknown,
  cwd: string,
  index: SkillIndex,
): SkillIndexEntry | null => {
  if (toolName !== "read") return null;
  const path = (args as { path?: unknown } | null | undefined)?.path;
  if (typeof path !== "string" || path.trim() === "") return null;
  return index.byFile.get(normalizeSkillFile(path, cwd)) ?? null;
};

/** 一条用户输入是否显式调用了某个技能；判据与 pi 的 `/skill:` 展开完全一致 */
export const matchSkillInvoke = (text: string, index: SkillIndex): SkillIndexEntry | null => {
  const name = SKILL_PATTERN.exec(text.trim())?.[1];
  return name ? (index.byName.get(name) ?? null) : null;
};
