/**
 * 编辑器的 Tiptap 配置：结构节点（段落 / 硬换行 / 有序与无序列表）+ 三个 mention + 历史，以及 editorProps。
 *
 * 单独一个模块是为了让 `editor.tsx` 只留「装配」：这里全是声明式配置，没有组件状态。
 * 回调一律经 ref 读取（`ComposerCallbacks`）——Tiptap 实例只在挂载时创建一次，直接传函数会拿到旧闭包。
 */

import { Extension, type Extensions } from "@tiptap/core";
import BulletList from "@tiptap/extension-bullet-list";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import ListItem from "@tiptap/extension-list-item";
import Mention from "@tiptap/extension-mention";
import OrderedList from "@tiptap/extension-ordered-list";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import Text from "@tiptap/extension-text";
import { history, redo, undo } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorProps } from "@tiptap/pm/view";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { DialectDiagnostic } from "@ucode/markdown";
import {
  DESIGN_NODE_NODE,
  escapeDialect,
  hasDialectSyntax,
  type InvocationCandidates,
  PAGE_ELEMENT_NODE,
} from "@ucode/markdown";
import type { RefObject } from "react";

import { isTouchInput } from "../../../utils/platform";
import { ATTACHMENT_NODE, AttachmentChipView } from "./attachment-chip";
import { findCommandMatch } from "./command-trigger";
import { DesignNodeChipView } from "./design-node-chip";
import { createDialectMarks } from "./dialect-marks";
import { createDialectSuggestion } from "./dialect-suggestion";
import { composerKeyIntentOf } from "./key-intent";
import { PageElementChipView } from "./page-element-chip";
import { createSuggestionRenderer, type SuggestionItem } from "./suggestion";
import { filesOf } from "./use-composer-attachments";

const CHIP_CLASS = "rounded-xs bg-muted px-1 py-0.5 text-foreground";

/** 可编辑区的类：高度上限、内边距与占位提示的呈现；高度对输入区与消息编辑态一视同仁（同一个编辑器、同一种手感）
 *
 * 列表标记要显式恢复：Tailwind 的预检把 `list-style` 清掉了，不加就只剩缩进没有圆点 / 编号
 * （与消息区 `.md-content` 的写法保持一致）。 */
const CONTENT_CLASS =
  "max-h-55 min-h-16 overflow-y-auto px-3 py-3 text-sm outline-none [&_.is-editor-empty]:before:pointer-events-none [&_.is-editor-empty]:before:float-left [&_.is-editor-empty]:before:h-0 [&_.is-editor-empty]:before:text-foreground-subtle [&_.is-editor-empty]:before:content-[attr(data-placeholder)] [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:pl-5 [&_ul]:pl-5";

/** 编辑器要用的回调与开关：全部经 ref 取最新实现 */
export type ComposerCallbacks = {
  contextItems: RefObject<((query: string) => Promise<SuggestionItem[]>) | undefined>;
  commandItems: RefObject<((query: string) => SuggestionItem[]) | undefined>;
  /** 方言菜单（行首 `:::`）的候选：命令与技能的名字 */
  dialectItems: RefObject<((query: string) => SuggestionItem[]) | undefined>;
  /** 方言解析要用的清单：判定围栏里的名字写没写对 */
  dialectCandidates: RefObject<InvocationCandidates | undefined>;
  /** 围栏写错时的行内提示文案 */
  dialectMessage: RefObject<((diagnostic: DialectDiagnostic) => string) | undefined>;
  onBuiltin: RefObject<((id: string) => void) | undefined>;
  onFiles: RefObject<((files: File[]) => void) | undefined>;
  onEscape: RefObject<(() => void) | undefined>;
  onSend: RefObject<() => void>;
  /** 建议弹层是否有候选：有则把 Enter / 方向键让给弹层 */
  suggestionOpen: RefObject<boolean>;
};

/**
 * 撤销 / 重做：本轮没有引入 `@tiptap/extension-undo-redo`，直接用已装的 ProseMirror 历史插件包一层，
 * 与 Tiptap 自带扩展同一套命令。
 */
const History = Extension.create({
  name: "history",
  addProseMirrorPlugins() {
    return [history()];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-z": () => undo(this.editor.view.state, this.editor.view.dispatch),
      "Mod-Shift-z": () => redo(this.editor.view.state, this.editor.view.dispatch),
      "Mod-y": () => redo(this.editor.view.state, this.editor.view.dispatch),
    };
  },
});

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

const AttachmentMention = Mention.extend({
  name: ATTACHMENT_NODE,
  addAttributes() {
    return {
      id: { default: null },
      name: { default: null },
      kind: { default: "file" },
      /** 上传中的占位标识；拿到 id 后清空，见 `useComposerAttachments` */
      tempId: { default: null },
    };
  },
  /** 附件不从键盘输入来（粘贴 / 拖拽 / 上传），因此没有触发符，也就没有建议弹层 */
  addProseMirrorPlugins() {
    return [];
  },
  /**
   * 父类的 Backspace 是给「打出来的 mention」用的：删掉节点再把触发符写回去。附件没有触发符，
   * 那个实现会把按键吞掉却不删节点，直接交给浏览器的默认行为（相邻的原子节点整体删除）。
   */
  addKeyboardShortcuts() {
    return {};
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentChipView);
  },
  /** 正文里的位置标记由方言投影生成，序列化到剪贴板时不再夹带一份 */
  renderText: () => "",
});

const PageElementMention = Mention.extend({
  name: PAGE_ELEMENT_NODE,
  addAttributes() {
    return {
      label: { default: null },
      summary: { default: null },
      url: { default: null },
      title: { default: null },
      selector: { default: null },
    };
  },
  /** 同附件：不是从键盘打出来的，因此没有触发符，也就没有建议弹层 */
  addProseMirrorPlugins() {
    return [];
  },
  addKeyboardShortcuts() {
    return {};
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageElementChipView);
  },
  /** 正文里的完整摘要由方言投影生成，序列化到剪贴板时不再夹带一份 */
  renderText: () => "",
});

/**
 * 设计画布上选出来的节点：与页面元素同形（芯片 + 只在正文里出锚点），
 * 但不从键盘输入来，因此没有触发符、也就没有建议弹层。
 */
const DesignNodeMention = Mention.extend({
  name: DESIGN_NODE_NODE,
  addAttributes() {
    return {
      label: { default: null },
      anchor: { default: null },
    };
  },
  addProseMirrorPlugins() {
    return [];
  },
  addKeyboardShortcuts() {
    return {};
  },
  addNodeView() {
    return ReactNodeViewRenderer(DesignNodeChipView);
  },
  /** 正文里的锚点由方言投影生成，序列化到剪贴板时不再夹带一份 */
  renderText: () => "",
});

/**
 * `@`：任意位置，候选由 `contextItems` 给（异步检索文件）；`enabled` 为假则整个菜单停用
 */
const createContextMention = (callbacks: ComposerCallbacks, enabled: boolean) =>
  ContextMention.configure({
    HTMLAttributes: { class: CHIP_CLASS },
    renderText: () => "",
    suggestion: {
      char: "@",
      allow: () => enabled,
      items: ({ query }) => callbacks.contextItems.current?.(query) ?? [],
      render: createSuggestionRenderer((active) => {
        callbacks.suggestionOpen.current = active;
      }),
      command: ({ editor, range, props }) => {
        const item = props as SuggestionItem;
        editor
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
  });

/**
 * `/`：仅文档开头（`range.from === 1`），候选是内置动作 + 命令 + 技能；`enabled` 为假则整个菜单停用。
 * 触发符除 `/` 外也认中文输入法下的 `、`（见 `./command-trigger`）；选中后落进正文的都是 `/name`。
 */
const createCommandMention = (callbacks: ComposerCallbacks, enabled: boolean) =>
  CommandMention.configure({
    HTMLAttributes: { class: CHIP_CLASS },
    renderText: ({ node }) =>
      node.attrs.kind === "skill" ? `/skill:${node.attrs.name}` : `/${node.attrs.name}`,
    suggestion: {
      char: "/",
      // `char` 只收单个字符，多触发符靠覆盖匹配实现（`findCommandMatch` 内部仍用它逐个触发符试）
      findSuggestionMatch: findCommandMatch,
      allow: ({ range }) => enabled && range.from === 1,
      items: ({ query }) => callbacks.commandItems.current?.(query) ?? [],
      render: createSuggestionRenderer((active) => {
        callbacks.suggestionOpen.current = active;
      }),
      command: ({ editor, range, props }) => {
        const item = props as SuggestionItem;
        if (typeof item.builtin === "string") {
          // 参数型命令（如 `/goal`）只把命令名填进去，等用户在正文里补参数，不立即执行
          if (item.takesArgument === true || !callbacks.onBuiltin.current) {
            editor.chain().insertContentAt(range, `${item.label} `).focus("end").run();
            return;
          }
          editor.chain().focus().deleteRange(range).run();
          callbacks.onBuiltin.current(item.builtin);
          return;
        }
        editor
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
  });

export const createComposerExtensions = (
  callbacks: ComposerCallbacks,
  flags: { context: boolean; command: boolean; dialect: boolean; placeholder: string },
): Extensions => [
  Document,
  Paragraph,
  Text,
  HardBreak,
  // 列表：输入规则（`- ` / `1. `）与 Enter 续行、Tab 缩进都由这三个扩展提供
  BulletList,
  OrderedList,
  ListItem,
  History,
  createContextMention(callbacks, flags.context),
  createCommandMention(callbacks, flags.command),
  createDialectSuggestion({
    items: callbacks.dialectItems,
    suggestionOpen: callbacks.suggestionOpen,
  }),
  createDialectMarks({
    candidates: () => callbacks.dialectCandidates.current,
    message: (diagnostic) => callbacks.dialectMessage.current?.(diagnostic) ?? "",
  }),
  AttachmentMention,
  PageElementMention,
  DesignNodeMention,
  Placeholder.configure({ placeholder: flags.placeholder }),
];

/** 光标是否在列表项里：在列表里 Enter 归列表用（续行 / 退出列表），不该把消息发出去 */
const isInsideListItem = (state: EditorState): boolean => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "listItem") return true;
  }
  return false;
};

/** 编辑器的 DOM 行为：粘贴 / 拖拽入库、Esc、Enter 发送 */
export const createEditorProps = (callbacks: ComposerCallbacks): EditorProps => ({
  attributes: { class: CONTENT_CLASS },
  handlePaste: (view, event) => {
    const onFiles = callbacks.onFiles.current;
    const files = onFiles ? filesOf(event.clipboardData) : [];
    if (onFiles && files.length > 0) {
      event.preventDefault();
      onFiles(files);
      return true;
    }
    // 粘进来的文本里若藏着会生效的方言记号，先转义再落进文档：否则一段来路不明的文字
    // 会悄悄把 `~/.ssh/id_rsa` 读进上下文、或让 `:::command[… ]` 变成一条命令
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!text || !hasDialectSyntax(text)) return false;
    event.preventDefault();
    const schema = view.state.schema;
    const paragraph = schema.nodes.paragraph;
    if (!paragraph) return false;
    const nodes = escapeDialect(text)
      .split("\n")
      .map((line) => paragraph.create(null, line.length > 0 ? schema.text(line) : undefined));
    view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(Fragment.fromArray(nodes))));
    return true;
  },
  handleDrop: (_view, event) => {
    const onFiles = callbacks.onFiles.current;
    if (!onFiles) return false;
    const files = filesOf(event.dataTransfer);
    if (files.length === 0) return false;
    event.preventDefault();
    onFiles(files);
    return true;
  },
  handleKeyDown: (view, event) => {
    switch (
      composerKeyIntentOf(event, {
        suggestionOpen: callbacks.suggestionOpen.current,
        inList: isInsideListItem(view.state),
        escape: callbacks.onEscape.current !== undefined,
        touch: isTouchInput(),
      })
    ) {
      // 弹层有候选时导航键让给弹层：Enter 选中当前项，而不是把消息发出去
      case "suggestion":
        return false;
      case "escape":
        event.preventDefault();
        callbacks.onEscape.current?.();
        return true;
      case "send":
        event.preventDefault();
        callbacks.onSend.current();
        return true;
      default:
        return false;
    }
  },
});
