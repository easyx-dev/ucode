import { type Component, Editor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { tint } from "./theme.ts";
import { padLine } from "./view.ts";

/** 已经排版好的行：宽度由视图层按屏幕宽度算好，这里原样输出（不再二次折行）。 */
export class RawLines implements Component {
  #lines: string[];

  constructor(lines: readonly string[]) {
    this.#lines = [...lines];
  }

  setLines(lines: readonly string[]): void {
    this.#lines = [...lines];
  }

  render(): string[] {
    return this.#lines;
  }

  invalidate(): void {}
}

/**
 * 给编辑器画边框的两个哨兵。
 *
 * `Editor.render()` 会把"上边框 / 正文 / 下边框 / 自动补全"拼成一个数组，
 * 而我们要把正文与补全都框进同一个方框里——所以用一个不可能出现在输入里的标记
 * 把边界标出来，由 `PromptFrame` 摘掉后重画（NUL 不是合法的终端输入字符）。
 */
const TOP_MARKER = "\u0000frame:top\u0000";
const BOTTOM_MARKER = "\u0000frame:bottom\u0000";

/**
 * 只改边框的编辑器：正文与补全仍由基座渲染（折行、光标、IME 都归它管），
 * 我们只把两条边框换成标记，交给外面的框重画。
 */
export class FramedEditor extends Editor {
  /** 编辑器内部向上滚动了多少行（边框上要提示，否则用户以为内容丢了）。 */
  hiddenAbove = 0;

  protected override renderTopBorder(_width: number, hiddenLineCount: number): string {
    this.hiddenAbove = hiddenLineCount;
    return TOP_MARKER;
  }

  protected override renderBottomBorder(_width: number, _hiddenLineCount: number): string {
    return BOTTOM_MARKER;
  }
}

/**
 * 输入框里那个"能渲染、能收键、有焦点"的东西。
 *
 * 只声明用到的部分而不是直接要 `Editor`：框本身不关心编辑器的历史、撤销、补全，
 * 接口收窄之后边框的排版逻辑可以脱离终端单测（`FramedEditor` 结构上就满足它）。
 */
export type FrameEditor = {
  focused: boolean;
  /** 编辑器内部向上滚动了多少行（边框上要提示，否则用户以为内容丢了）。 */
  hiddenAbove: number;
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
};

export type PromptFrameOptions = {
  editor: FrameEditor;
  /** 顶部标签（`❯ 输入` / `❯ 回答提问`），随状态变化。 */
  label: () => string;
  /** 底部按键提示。 */
  hint: () => string;
};

/**
 * 输入框（opencode 的形态）：`╭─ ❯ 输入 ─╮` 包住正文与补全菜单，按键提示写在下边框上。
 *
 * 焦点转发是硬要求：TUI 把焦点设在本组件上，而真正要发光标的是里面的编辑器
 * （没有光标位置，输入法候选框会跑到屏幕角落）。
 */
export class PromptFrame implements Component {
  readonly #editor: FrameEditor;
  readonly #label: () => string;
  readonly #hint: () => string;

  constructor(options: PromptFrameOptions) {
    this.#editor = options.editor;
    this.#label = options.label;
    this.#hint = options.hint;
  }

  get focused(): boolean {
    return this.#editor.focused;
  }

  set focused(value: boolean) {
    this.#editor.focused = value;
  }

  render(width: number): string[] {
    const total = Math.max(12, width);
    const inner = total - 4; // "│ " + inner + " │"
    const rows = this.#editor.render(inner);

    const body: string[] = [];
    let index = 1; // rows[0] 是上边框标记
    while (index < rows.length) {
      const row = rows[index] ?? "";
      index += 1;
      if (row.startsWith(BOTTOM_MARKER)) break;
      body.push(row);
    }
    // 补全菜单接在正文之后、下边框之前：菜单在框里，视线不用跳到框外。
    for (const row of rows.slice(index)) body.push(row);

    const border = tint.border("│");
    return [
      this.#topBorder(total),
      ...body.map((row) => `${border} ${padLine(row, inner)} ${border}`),
      this.#bottomBorder(total),
    ];
  }

  handleInput(data: string): void {
    this.#editor.handleInput(data);
  }

  invalidate(): void {
    this.#editor.invalidate();
  }

  #topBorder(width: number): string {
    const scrolled =
      this.#editor.hiddenAbove > 0 ? ` ${tint.faint(`↑${this.#editor.hiddenAbove}`)}` : "";
    const label = truncateToWidth(
      `─ ${tint.accent("❯")} ${tint.muted(this.#label())}${scrolled} `,
      Math.max(0, width - 2),
    );
    const fill = Math.max(0, width - 2 - visibleWidth(label));
    const border = tint.border;
    return `${border("╭")}${label}${border("─".repeat(fill))}${border("╮")}`;
  }

  #bottomBorder(width: number): string {
    const hint = this.#hint();
    // 窄屏上提示会顶破边框：宁可截断提示，也不能让方框变形。
    const label =
      hint === "" ? "" : truncateToWidth(` ${tint.faint(hint)} `, Math.max(0, width - 4));
    const fill = Math.max(0, width - 3 - visibleWidth(label));
    const border = tint.border;
    return `${border("╰─")}${label}${border("─".repeat(fill))}${border("╯")}`;
  }
}
