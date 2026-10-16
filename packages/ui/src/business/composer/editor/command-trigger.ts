/**
 * 命令菜单的触发符：`/` 与中文输入法下的顿号 `、`。
 *
 * 单独一个模块（同 `./key-intent`）：`./extensions` 会连带 `.tsx` 组件与品牌资源，进不了 node 的
 * 测试链路，而「打什么会唤起菜单」这件事值得单独钉住。
 */
import { findSuggestionMatch } from "@tiptap/suggestion";

/** 能唤起命令菜单的触发符；中文输入法下常常打不出半角斜杠，顿号是同一个键位的顺手选择 */
export const COMMAND_TRIGGERS = ["/", "、"] as const;

/**
 * 认多个触发符的匹配。
 *
 * Tiptap 的 `char` 只收单个字符（`SuggestionOptions.char?: string`），所以覆盖它默认的
 * `findSuggestionMatch`：逐个触发符各问一次默认实现，取最靠右的那个——也就是最近输入的那个。
 * 行首限定、空白前缀与查询串的取法都沿用默认实现（配置原样透传，只换 `char`）。
 */
export const findCommandMatch: typeof findSuggestionMatch = (config) => {
  let best: ReturnType<typeof findSuggestionMatch> = null;
  for (const char of COMMAND_TRIGGERS) {
    const match = findSuggestionMatch({ ...config, char });
    if (match && (!best || match.range.from > best.range.from)) best = match;
  }
  return best;
};
