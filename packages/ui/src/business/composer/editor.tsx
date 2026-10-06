/**
 * 输入区编辑器（Tiptap）：只装结构节点与两个 mention，无任何排版 marks。
 *
 * - `@`：`contextMention`（任意位置），发送时剥离为 `contexts[]`
 * - `/`：`commandMention`（仅文档开头），序列化为 `/name` 或 `/skill:name`；内置动作为空节点、立即执行
 */
import type { Editor, JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Mention from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";
import { EditorContent, useEditor } from "@tiptap/react";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import type { ComposerNode } from "../../lib/composer-document";
import { createSuggestionRenderer, type SuggestionItem } from "./suggestion";
import { filesOf } from "./use-composer-attachments";

const CHIP_CLASS = "rounded bg-muted px-1 py-0.5 text-foreground";

const ContextMention = Mention.extend({
  name: "contextMention",
  addAttributes() {
    return {
      path: { default: null },
      startLine: { default: null },
      endLine: { default: null },
      label: { default: null },
    };
  },
});

const CommandMention = Mention.extend({
  name: "commandMention",
  addAttributes() {
    return {
      kind: { default: "prompt" },
      name: { default: null },
      label: { default: null },
    };
  },
  /**
   * 默认实现会把触发符再拼一次（`char` + label），而这里的 label 本身就是 `/name`、`/skill:name`，
   * 拼上去会在编辑器里显示成 `//review`。直接输出 label。
   */
  renderHTML({ node, HTMLAttributes }) {
    return ["span", HTMLAttributes, node.attrs.label ?? ""];
  },
});

export type ComposerEditorProps = {
  /** 初始文档（挂载时读取一次；切换草稿由外层用 `key` 重挂载） */
  initialDoc?: ComposerNode;
  placeholder: string;
  onChange: (doc: ComposerNode) => void;
  onSend: () => void;
  /** `@` 的文件候选（异步） */
  contextItems: (query: string) => Promise<SuggestionItem[]>;
  /** `/` 的内置动作 + 命令 + 技能候选 */
  commandItems: (query: string) => SuggestionItem[];
  /** 选中内置动作时触发（不落节点） */
  onBuiltin: (id: string) => void;
  /** 粘贴 / 拖拽进来的文件（附件），由外层压缩入库 */
  onFiles: (files: File[]) => void;
};

/** 供外层把焦点收回输入区（发送之后、选择器关掉之后） */
export type ComposerEditorHandle = {
  focus: () => void;
};

/** 只在桌面指针环境下自动聚焦：触屏上抢焦点等于凭空唤起键盘 */
const canAutoFocus = (): boolean => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function ComposerEditor({
  ref,
  initialDoc,
  placeholder,
  onChange,
  onSend,
  contextItems,
  commandItems,
  onBuiltin,
  onFiles,
}: ComposerEditorProps & { ref?: Ref<ComposerEditorHandle> }) {
  // 回调放 ref：Tiptap 实例只在挂载时创建一次，用它拿最新实现
  const onChangeRef = useRef(onChange);
  const onSendRef = useRef(onSend);
  const onBuiltinRef = useRef(onBuiltin);
  const contextItemsRef = useRef(contextItems);
  const commandItemsRef = useRef(commandItems);
  const onFilesRef = useRef(onFiles);
  onChangeRef.current = onChange;
  onSendRef.current = onSend;
  onBuiltinRef.current = onBuiltin;
  contextItemsRef.current = contextItems;
  commandItemsRef.current = commandItems;
  onFilesRef.current = onFiles;

  const editorRef = useRef<Editor | null>(null);

  // 弹层是否有候选：有则把 Enter / 方向键让给弹层，避免被发送逻辑抢走
  const suggestionOpen = useRef(false);
  const renderContext = useRef(
    createSuggestionRenderer((active) => {
      suggestionOpen.current = active;
    }),
  ).current;
  const renderCommand = useRef(
    createSuggestionRenderer((active) => {
      suggestionOpen.current = active;
    }),
  ).current;

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      ContextMention.configure({
        HTMLAttributes: { class: CHIP_CLASS },
        renderText: () => "",
        suggestion: {
          char: "@",
          items: ({ query }) => contextItemsRef.current(query),
          render: renderContext,
          command: ({ editor: target, range, props }) => {
            const item = props as SuggestionItem;
            target
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: "contextMention",
                  attrs: {
                    path: item.path,
                    startLine: item.startLine ?? null,
                    endLine: item.endLine ?? null,
                    label: item.label,
                  },
                },
                { type: "text", text: " " },
              ])
              .run();
          },
        },
      }),
      CommandMention.configure({
        HTMLAttributes: { class: CHIP_CLASS },
        renderText: ({ node }) =>
          node.attrs.kind === "skill" ? `/skill:${node.attrs.name}` : `/${node.attrs.name}`,
        suggestion: {
          char: "/",
          allow: ({ range }) => range.from === 1,
          items: ({ query }) => commandItemsRef.current(query),
          render: renderCommand,
          command: ({ editor: target, range, props }) => {
            const item = props as SuggestionItem;
            if (typeof item.builtin === "string") {
              target.chain().focus().deleteRange(range).run();
              onBuiltinRef.current(item.builtin);
              return;
            }
            target
              .chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: "commandMention",
                  attrs: { kind: item.kind, name: item.name, label: item.label },
                },
                { type: "text", text: " " },
              ])
              .run();
          },
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: (initialDoc ?? { type: "doc", content: [{ type: "paragraph" }] }) as JSONContent,
    editorProps: {
      attributes: {
        class:
          "max-h-[220px] min-h-11 overflow-y-auto px-3 py-2.5 text-sm outline-none [&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:text-muted-foreground [&_.is-editor-empty]:before:content-[attr(data-placeholder)]",
      },
      handlePaste: (_view, event) => {
        const files = filesOf(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        onFilesRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = filesOf(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        onFilesRef.current(files);
        return true;
      },
      handleKeyDown: (_view, event) => {
        // 弹层有候选时，导航键让给弹层：Enter 选中当前项，而不是把消息发出去
        if (
          suggestionOpen.current &&
          ["Enter", "ArrowDown", "ArrowUp", "Escape", "Tab"].includes(event.key)
        ) {
          return false;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          onSendRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: target }) => {
      onChangeRef.current(target.getJSON() as ComposerNode);
    },
    // 进入 / 切换会话都以新的 key 重挂载，这里等于「开启或切换会话后把光标放回输入区」
    onCreate: ({ editor: target }) => {
      if (canAutoFocus()) target.commands.focus("end");
    },
  });

  editorRef.current = editor;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editorRef.current?.commands.focus("end");
      },
    }),
    [],
  );

  useEffect(
    () => () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    },
    [],
  );

  return <EditorContent editor={editor} />;
}
