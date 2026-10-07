/**
 * shiki 主题：颜色全部指向 `theme.css` 里的 `--code-*` 变量，因此深浅色与设计 token 天然对齐。
 *
 * shiki 自 v0.9.15 起支持任意颜色值（非十六进制会被占位再还原），所以这里直接写 `var(--code-*)`，
 * 不必用 `colorReplacements` 去猜某个内置主题的十六进制。代价是脱离 TextMate 生态
 * （`shiki-cli` / `shiki-monaco` 不认），而本项目只在浏览器里渲染，不涉及。
 */
// 取 `values` 入口：只有品牌串，不牵入 assets（Node 侧测试会直接加载本模块）
import { brand } from "@ucode/brand/values";
import type { ThemeRegistration } from "shiki/core";

/** shiki 主题名；`highlightLines` 里按它取主题（带品牌前缀，避免与内置主题同名） */
export const CODE_THEME_NAME = `${brand.slug}-code`;

type Rule = { scope: string[]; settings: { foreground: string } };

const rule = (scope: string[], foreground: string): Rule => ({
  scope,
  settings: { foreground: `var(${foreground})` },
});

export const codeTheme: ThemeRegistration = {
  name: CODE_THEME_NAME,
  // 只表达「这是深色底偏好」；实际颜色由变量决定，深浅色两块都适用
  type: "dark",
  fg: "var(--code-foreground)",
  bg: "var(--code-background)",
  settings: [
    rule(["comment", "punctuation.definition.comment", "string.comment"], "--code-comment"),
    rule(["keyword", "storage", "storage.type", "storage.modifier"], "--code-keyword"),
    rule(
      ["variable.language", "keyword.operator.new", "keyword.operator.expression"],
      "--code-keyword",
    ),
    rule(["string", "punctuation.definition.string", "string.regexp"], "--code-string"),
    rule(["constant.numeric", "constant.language", "constant.character"], "--code-number"),
    rule(["constant.other", "support.constant", "constant.other.symbol"], "--code-number"),
    rule(
      ["entity.name.function", "support.function", "meta.function-call", "variable.function"],
      "--code-function",
    ),
    rule(
      [
        "entity.name.type",
        "entity.name.class",
        "entity.name.struct",
        "entity.other.inherited-class",
        "support.type",
        "support.class",
      ],
      "--code-type",
    ),
    rule(["entity.name.tag", "punctuation.definition.tag"], "--code-tag"),
    rule(
      [
        "entity.other.attribute-name",
        "variable.other.property",
        "variable.other.object.property",
        "meta.object-literal.key",
        "support.type.property-name",
        "meta.structure.dictionary.key",
      ],
      "--code-property",
    ),
    rule(
      ["variable", "variable.other", "variable.parameter", "meta.definition.variable"],
      "--code-variable",
    ),
    rule(
      ["keyword.operator", "punctuation", "punctuation.separator", "meta.brace"],
      "--code-punctuation",
    ),
    rule(["markup.underline.link", "string.other.link", "markup.underline"], "--code-link"),
    rule(["invalid", "invalid.illegal"], "--code-invalid"),
    // diff / 补丁文件自身的增删行：与 diff 面板的语义色保持一致
    rule(["markup.inserted", "meta.diff.header.to-file"], "--code-string"),
    rule(["markup.deleted", "meta.diff.header.from-file"], "--code-invalid"),
  ],
};
