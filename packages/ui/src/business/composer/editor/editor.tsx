/**
 * 消息编辑器（Tiptap）：只装结构节点与三个 mention，无任何排版 marks；输入区与消息编辑态共用。
 *
 * - `@`：`contextMention`（任意位置），发送时落成正文里的 `@路径` 标记并收进 `contexts[]`
 * - `/`：`commandMention`（仅文档开头），序列化为 `/name` 或 `/skill:name`；内置动作为空节点、立即执行。
 *   不传 `commandItems` 时整个菜单停用（消息编辑态：命令节点只读，不能再造一个）
 * - 附件：`attachmentMention` 原子节点，图片按缩略图预览、其余只显示文件名；正文里的位置标记由它生成
 * - 历史：`@tiptap/pm/history` 的插件包一层，`⌘Z` 撤销、`⌘⇧Z` 与 `⌘Y` 前进
 *
 * 扩展与 editorProps 在 `./extensions`，命令式句柄在 `./editor-handle`。
 */
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import type { ComposerNode } from "../document/composer-document";
import { type ComposerEditorHandle, createEditorHandle } from "./editor-handle";
import { type ComposerCallbacks, createComposerExtensions, createEditorProps } from "./extensions";
import type { SuggestionItem } from "./suggestion";

export type { ComposerEditorHandle };

export type ComposerEditorProps = {
  /** 初始文档（挂载时读取一次；切换草稿 / 切换编辑对象由外层用 `key` 重挂载） */
  initialDoc?: ComposerNode;
  placeholder: string;
  onChange: (doc: ComposerNode) => void;
  onSend: () => void;
  /** `@` 的文件候选（异步）；不传则 `@` 菜单停用 */
  contextItems?: (query: string) => Promise<SuggestionItem[]>;
  /** `/` 的内置动作 + 命令 + 技能候选；不传则 `/` 菜单停用 */
  commandItems?: (query: string) => SuggestionItem[];
  /** 选中内置动作时触发（不落节点） */
  onBuiltin?: (id: string) => void;
  /** 粘贴 / 拖拽进来的文件（附件），由外层上传入库 */
  onFiles?: (files: File[]) => void;
  /** Esc：消息编辑态用它退出（弹层开着时先由弹层处理） */
  onEscape?: () => void;
};

type EditorProps = ComposerEditorProps & { ref?: Ref<ComposerEditorHandle> };

/** 只在桌面指针环境下自动聚焦：触屏上抢焦点等于凭空唤起键盘 */
const canAutoFocus = (): boolean => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * 创建编辑器实例并把句柄交给外层。
 *
 * Tiptap 实例只在挂载时创建一次：回调一律经 ref 取最新实现（`extensions` 里读 `.current`）；
 * 扩展与 editorProps 也只算一次——建议插件在挂载时就抓住了它们，之后重算既不会生效，
 * 还会让 `useEditor` 每次渲染都以为「选项变了」而调 `setOptions`。菜单开关同理取挂载时的值
 * （挂载后不会变，变也由外层用 `key` 重挂载）。
 */
const useComposerEditor = ({ ref, initialDoc, placeholder, ...props }: EditorProps) => {
  const callbacks: ComposerCallbacks = {
    contextItems: useRef(props.contextItems),
    commandItems: useRef(props.commandItems),
    onBuiltin: useRef(props.onBuiltin),
    onFiles: useRef(props.onFiles),
    onEscape: useRef(props.onEscape),
    onSend: useRef(props.onSend),
    suggestionOpen: useRef(false),
  };
  callbacks.contextItems.current = props.contextItems;
  callbacks.commandItems.current = props.commandItems;
  callbacks.onBuiltin.current = props.onBuiltin;
  callbacks.onFiles.current = props.onFiles;
  callbacks.onEscape.current = props.onEscape;
  callbacks.onSend.current = props.onSend;

  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  const editorRef = useRef<Editor | null>(null);
  const options = useRef({
    extensions: createComposerExtensions(callbacks, {
      context: props.contextItems !== undefined,
      command: props.commandItems !== undefined,
      placeholder,
    }),
    content: (initialDoc ?? { type: "doc", content: [{ type: "paragraph" }] }) as JSONContent,
    editorProps: createEditorProps(callbacks),
  }).current;

  const editor = useEditor({
    ...options,
    onUpdate: ({ editor: target }) => {
      onChangeRef.current(target.getJSON() as ComposerNode);
    },
    // 进入 / 切换会话都以新的 key 重挂载，这里等于「开启或切换会话后把光标放回输入区」
    onCreate: ({ editor: target }) => {
      if (canAutoFocus()) target.commands.focus("end");
    },
  });

  editorRef.current = editor;
  useImperativeHandle(ref, () => createEditorHandle(() => editorRef.current), []);

  useEffect(
    () => () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    },
    [],
  );

  return editor;
};

export function ComposerEditor(props: EditorProps) {
  return <EditorContent editor={useComposerEditor(props)} />;
}
