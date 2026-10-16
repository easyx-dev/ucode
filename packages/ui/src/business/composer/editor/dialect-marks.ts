/**
 * 方言记号在编辑器里的呈现：容器围栏显示成芯片、写错的地方就地标出原因。
 *
 * 纯装饰、**不改文档**——用户打的 `:::command[todo]` 仍是普通文本，发送时才由 `@ucode/markdown`
 * 定型成载荷。围栏规则取自那个包（与发送路径同一份），这里只把文本区间映射到文档位置。
 *
 * 编辑器里没有代码块节点，代码围栏只能是一行行文本，所以这里顺手按行跳过它们（与解析器一致）。
 */
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type DialectDiagnostic, type InvocationCandidates, scanContainers } from "@ucode/markdown";

/** 围栏行：一小片芯片，与消息区的命令 chip 同一套观感 */
const CHIP_CLASS = "rounded-xs bg-muted px-1 font-mono text-xs text-foreground-subtle";
/** 转义符（`\@`、`\!`、行首 `\:::`）：淡一点，让用户看出这个反斜杠是有意的、不是打错 */
const DIM_CLASS = "text-foreground-subtle/40";
/** 写错的行：同形状但走报错色 */
const ERROR_CLASS = "rounded-xs bg-destructive/10 px-1 font-mono text-xs text-destructive";
const HINT_CLASS = "ml-1 rounded-xs px-1 text-xs text-destructive";

/** 文档里一块文本：`docFrom` 是块内第一个内容位置，`text` 是它的纯文本（硬换行算一个 `\n`） */
export type DialectBlock = { docFrom: number; text: string };

export type DialectMark = {
  kind: "chip" | "close" | "error" | "dim";
  /** 文本偏移（相对 `blocks` 拼起来的全文） */
  from: number;
  to: number;
  diagnostic?: DialectDiagnostic;
};

const textOfBlock = (node: ProseMirrorNode): string => {
  let text = "";
  node.forEach((child) => {
    if (child.isText) text += child.text ?? "";
    else if (child.type.name === "hardBreak") text += "\n";
  });
  return text;
};

/** 文档 → 参与方言判定的块文本（文本块各自成一块，顺序即先后） */
export const dialectBlocksOf = (doc: ProseMirrorNode): DialectBlock[] => {
  const blocks: DialectBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    blocks.push({ docFrom: pos + 1, text: textOfBlock(node) });
    return false;
  });
  return blocks;
};

/** 块文本拼成全文；`docPosOf` 把文本偏移映射回文档位置 */
export const dialectTextOf = (blocks: readonly DialectBlock[]): string =>
  blocks.map((block) => block.text).join("\n");

const docPosOf = (blocks: readonly DialectBlock[], offset: number): number => {
  let textFrom = 0;
  for (const block of blocks) {
    const textTo = textFrom + block.text.length;
    if (offset <= textTo) return block.docFrom + Math.min(offset - textFrom, block.text.length);
    textFrom = textTo + 1;
  }
  const last = blocks.at(-1);
  return last ? last.docFrom + last.text.length : 0;
};

/** 代码围栏覆盖的文本区间（``` / ~~~ 成对出现；未闭合就一直延伸到文末，与解析器一致） */
const codeRanges = (text: string): { from: number; to: number }[] => {
  const ranges: { from: number; to: number }[] = [];
  let openFrom: number | null = null;
  for (const match of text.matchAll(/^[ \t]*(```+|~~~+).*$/gm)) {
    const at = match.index ?? 0;
    if (openFrom === null) {
      openFrom = at;
      continue;
    }
    ranges.push({ from: openFrom, to: at + match[0].length });
    openFrom = null;
  }
  if (openFrom !== null) ranges.push({ from: openFrom, to: text.length });
  return ranges;
};

/**
 * 全文 → 装饰用标记。给单测用：不需要 ProseMirror 文档，只要块文本。
 */
export const dialectMarksOf = (
  blocks: readonly DialectBlock[],
  candidates: InvocationCandidates | undefined,
): DialectMark[] => {
  const text = dialectTextOf(blocks);
  const marks: DialectMark[] = [];
  const code = codeRanges(text);
  const lineEndAfter = (offset: number): number => {
    const end = text.indexOf("\n", offset);
    return end === -1 ? text.length : end;
  };
  const inCode = (offset: number): boolean =>
    code.some((range) => offset >= range.from && offset <= range.to);

  for (const match of text.matchAll(/(?<!\\)\\(?=[@!:]|\[|\])/g)) {
    const at = match.index ?? 0;
    if (!inCode(at)) marks.push({ kind: "dim", from: at, to: at + 1 });
  }

  for (const fence of scanContainers(text, code)) {
    const openTo = lineEndAfter(fence.from);
    const known =
      candidates === undefined ||
      (fence.kind === "skill"
        ? candidates.skills.some((item) => item.name === fence.name)
        : candidates.prompts.some((item) => item.name === fence.name));

    const diagnostic: DialectDiagnostic | undefined = !fence.closed
      ? { code: "container-unclosed", name: fence.name, offset: fence.from }
      : fence.nestedAt !== null
        ? { code: "container-nested", name: fence.name, offset: fence.nestedAt }
        : !known
          ? {
              code: fence.kind === "skill" ? "skill-unknown" : "command-unknown",
              name: fence.name,
              offset: fence.from,
            }
          : undefined;

    marks.push({
      kind: diagnostic ? "error" : "chip",
      from: fence.from,
      to: openTo,
      ...(diagnostic ? { diagnostic } : {}),
    });
    if (diagnostic) continue;

    // 收尾围栏同样只是一行文本：淡一点，让容器的范围看得出来。
    // 内容为空时 `contentTo` 就是收尾行的行首；有内容时它停在收尾行前的那个换行上。
    const closeFrom = fence.contentFrom === fence.contentTo ? fence.contentTo : fence.contentTo + 1;
    if (fence.closed && closeFrom > openTo && closeFrom < text.length) {
      marks.push({ kind: "close", from: closeFrom, to: lineEndAfter(closeFrom) });
    }
  }

  return marks;
};

export type DialectMarkOptions = {
  candidates?: (() => InvocationCandidates | undefined) | undefined;
  message?: ((diagnostic: DialectDiagnostic) => string) | undefined;
};

const PLUGIN_KEY = new PluginKey("dialectMarks");

export const createDialectMarks = (options: DialectMarkOptions): Extension =>
  Extension.create({
    name: "dialectMarks",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: PLUGIN_KEY,
          props: {
            decorations: (state) => {
              const blocks = dialectBlocksOf(state.doc);
              if (blocks.length === 0) return null;
              const marks = dialectMarksOf(blocks, options.candidates?.());
              const decorations: Decoration[] = [];

              for (const mark of marks) {
                const from = docPosOf(blocks, mark.from);
                const to = Math.max(from + 1, docPosOf(blocks, mark.to));
                decorations.push(
                  Decoration.inline(from, to, {
                    class:
                      mark.kind === "error"
                        ? ERROR_CLASS
                        : mark.kind === "dim"
                          ? DIM_CLASS
                          : CHIP_CLASS,
                  }),
                );
                if (!mark.diagnostic || !options.message) continue;
                const message = options.message(mark.diagnostic);
                decorations.push(
                  Decoration.widget(
                    to,
                    () => {
                      const hint = document.createElement("span");
                      hint.className = HINT_CLASS;
                      hint.textContent = message;
                      return hint;
                    },
                    { side: 1 },
                  ),
                );
              }

              return DecorationSet.create(state.doc, decorations);
            },
          },
        }),
      ];
    },
  });
