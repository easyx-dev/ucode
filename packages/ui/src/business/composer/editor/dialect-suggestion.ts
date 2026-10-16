/**
 * `:::` 的建议菜单：在行首打三个冒号就能把命令 / 技能容器写出来。
 *
 * 选中后插入的是**方言文本**（`:::command[name]` + 空行 + `:::`），不是什么节点——
 * 容器本来就只是文本，编辑器只负责给出可点的入口、并在插入后把光标放到容器内容那一行。
 */
import { type Editor, Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";
import type { RefObject } from "react";
import { createSuggestionRenderer, type SuggestionItem } from "./suggestion";

export type DialectSuggestionOptions = {
  /** 行首 `:::` 之后的候选（命令与技能）；不传则这个菜单停用 */
  items: RefObject<((query: string) => SuggestionItem[]) | undefined>;
  suggestionOpen: RefObject<boolean>;
};

const PLUGIN_KEY = new PluginKey("dialectSuggestion");

/** 选中项 → 容器骨架；返回光标该落在的位置（内容那一行的行首） */
export const dialectSkeletonOf = (
  item: SuggestionItem,
): { nodes: unknown[]; caretOffset: number } => {
  const keyword = item.kind === "skill" ? "skill" : "command";
  const open = `:::${keyword}[${item.name}]`;
  return {
    nodes: [
      { type: "paragraph", content: [{ type: "text", text: open }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: ":::" }] },
    ],
    // 文档位置从 0 起：首段占 1 + 文本 + 1，再往后一格就是第二段（内容行）的内容起点
    caretOffset: open.length + 2,
  };
};

export const createDialectSuggestion = (options: DialectSuggestionOptions): Extension =>
  Extension.create({
    name: "dialectSuggestion",
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestionItem>({
          editor: this.editor as Editor,
          pluginKey: PLUGIN_KEY,
          char: ":",
          // 只在行首触发：正文里的冒号（`注意：`、时间写法）不该弹出菜单
          startOfLine: true,
          allowSpaces: false,
          // 默认的查询正则把触发符本身排除在外，连打冒号时匹配永远停在第一个冒号上：
          // 光标一走远就不算「还在查询」，菜单根本不出现。允许查询里再出现触发符即可。
          allowToIncludeChar: true,
          allow: () => options.items.current !== undefined,
          // 必须凑满三个冒号才认：`:` 与 `::` 阶段返回空候选，菜单自然不出现
          items: ({ query }) =>
            query.startsWith("::") ? (options.items.current?.(query) ?? []) : [],
          render: createSuggestionRenderer((active) => {
            options.suggestionOpen.current = active;
          }),
          command: ({ editor, range, props }) => {
            const item = props as SuggestionItem;
            const { nodes, caretOffset } = dialectSkeletonOf(item);
            // 插入与光标走同一条链、同一个事务：分两次命令的话，浏览器在下一次 selectionchange 里
            // 会拿旧 DOM 选区把光标位置盖回去，结果落在收尾围栏前面
            editor
              .chain()
              .focus()
              .insertContentAt(range, nodes as never)
              .setTextSelection(range.from + caretOffset)
              .run();
            return true;
          },
        }),
      ];
    },
  });
