/**
 * 插件文档守卫：`docs/plugin-authoring.md` 必须与 `plugin-create` 技能真身逐字节一致，
 * 漂移即报「运行 pnpm plugin:docs」（与 api-docs 同一套做法）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildPluginAuthoringDoc, PLUGIN_AUTHORING_DOC } from "../../plugin-docs/generate.ts";

export const run = (root: string): string[] => {
  const expected = buildPluginAuthoringDoc();
  let actual: string;
  try {
    actual = readFileSync(join(root, PLUGIN_AUTHORING_DOC), "utf8");
  } catch {
    return [`${PLUGIN_AUTHORING_DOC}：不存在，请运行 pnpm plugin:docs`];
  }
  return actual === expected
    ? []
    : [`${PLUGIN_AUTHORING_DOC} 与技能真身不一致，请运行 pnpm plugin:docs 重新生成`];
};
