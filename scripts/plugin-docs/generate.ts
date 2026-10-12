/**
 * 插件作者文档生成：`docs/plugin-authoring.md` 由 `plugin-create` 技能真身拼出。
 *
 * 与 `docs/api-reference.md` 同一套做法：真身是单一事实源（`BUILTIN_SKILLS` 里的 Markdown），
 * 这里只加一层前言与索引，`scripts/verify` 的 plugin-docs 校验比对生成结果与仓库里的文件。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { BUILTIN_SKILLS } from "../../server/src/harness/plugins/builtin/skills.ts";

/** 文档落点（相对仓库根） */
export const PLUGIN_AUTHORING_DOC = "docs/plugin-authoring.md";

const PREAMBLE = `# 插件开发

> 本文由 \`plugin-create\` 技能真身生成，**不要手工编辑**：改内容请改
> \`server/src/harness/plugins/builtin/skills.ts\`，再运行 \`pnpm plugin:docs\`。
>
> 面向使用者的说明（安装、启停、兼容范围与安全边界）见 [plugins.md](./plugins.md)。`;

/** 供校验与生成共用：拼出整篇文档 */
export const buildPluginAuthoringDoc = (): string => {
  const skill = BUILTIN_SKILLS.find((item) => item.id === "plugin-create");
  const body = skill?.files["SKILL.md"] ?? "";
  // 技能正文自带 frontmatter，文档里去掉它（标题由上面的前言给）
  const withoutFrontmatter = body.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const skillNotice = skill
    ? `\n\n---\n\n> 内置技能 \`plugin-create\`（v${skill.version}）与本文同源：在会话里用 \`/skill:plugin-create\` 可以边做边问。`
    : "";
  return `${PREAMBLE}\n\n${withoutFrontmatter}${skillNotice}\n`;
};

const main = (): void => {
  const root = join(import.meta.dirname, "..", "..");
  const content = buildPluginAuthoringDoc();
  writeFileSync(join(root, PLUGIN_AUTHORING_DOC), content, "utf8");
  console.log(`已生成 ${relative(root, join(root, PLUGIN_AUTHORING_DOC))}`);
};

if (process.argv[1]?.endsWith("generate.ts")) main();
