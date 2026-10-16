/**
 * `/` 与 `@` 共用的建议下拉：原生 DOM 渲染并固定在光标下方。
 *
 * 用原生 DOM 而非 React 渲染，避免再引入定位库（tippy）；键盘导航与选中由这里统一处理，
 * 选中项原样交给 Tiptap suggestion 的 `command`。面板宽度与左缘跟随编辑器所在的输入卡，
 * 条目一律单行（名称与描述各自截断）——面板宽度不随内容变，也不把卡外的地方盖住。
 */
import type { Editor } from "@tiptap/core";

export type SuggestionItem = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  /** 供扩展的 `command` 读取的附加字段（kind / name / path / startLine 等） */
  [key: string]: unknown;
};

type RendererProps = {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void;
  clientRect?: (() => DOMRect | null) | null;
  /** Tiptap 的 `SuggestionProps` 本来就带它，声明出来是为了拿输入卡的 rect 定宽 */
  editor?: Editor;
};

/** 弹层对按键的动作；`pass` 表示不消费，交回编辑器 */
export type SuggestionKeyAction = "previous" | "next" | "select" | "dismiss" | "pass";

/**
 * 按键 → 动作。两条容易踩的边界：
 * - `Shift+Enter` 是换行，输入法组合中的 `Enter` 是选字，都不能当成「选中当前项」——
 *   否则菜单开着时插不进换行，反倒把高亮那一条填了进去。
 * - 候选为空时什么都不消费，编辑器的发送逻辑照常生效。
 */
export const suggestionKeyActionOf = (
  event: { key: string; shiftKey?: boolean; isComposing?: boolean },
  count: number,
): SuggestionKeyAction => {
  if (count === 0) return "pass";
  if (event.key === "Escape" || event.key === "Esc") return "dismiss";
  if (event.key === "ArrowDown") return "next";
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "Tab") return "select";
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) return "select";
  return "pass";
};

/**
 * 方向键移动选中项。到头回绕：候选是几十项的一维列表，回绕比“停住不动”好用
 * （回绕方向与 `block: "nearest"` 的滚动配合，上下都跟手）。
 */
export const stepIndex = (current: number, delta: number, count: number): number =>
  count <= 0 ? 0 : (((current + delta) % count) + count) % count;

/**
 * 建议弹层的渲染工厂。
 * `onActiveChange` 在「有候选」时置真、关闭或候选为空时置假——编辑器据此把 Enter / 方向键
 * 让给弹层（否则会被发送逻辑抢走）。
 */
export const createSuggestionRenderer = (onActiveChange?: (active: boolean) => void) => () => {
  let container: HTMLDivElement | null = null;
  let current: RendererProps | null = null;
  let selected = 0;
  /** 已渲染的行，按 items 下标对齐；方向键只切换它们的类名，不重建 DOM */
  let rows: HTMLButtonElement[] = [];

  /** 高亮当前项并把它滚进视野：面板只有 `max-h-64`（约 8 行），候选常有四十多项，
   * 不滚的话高亮一走出可视区就「消失」，看着像方向键到头了 */
  const paint = (): void => {
    rows.forEach((row, index) => {
      const active = index === selected;
      row.classList.toggle("bg-muted", active);
      row.classList.toggle("text-foreground", active);
      row.classList.toggle("text-foreground-subtle", !active);
    });
    // 只动面板自身的滚动条：`scrollIntoView` 会连带滚动所有可滚动祖先（本面板挂在 body 上，
    // 定位之前更容易牵连到外层），按容器尺寸手算就没有这个牵连
    const row = rows[selected];
    if (!row || !container) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight;
    }
  };

  const render = (): void => {
    if (!container || !current) return;
    container.innerHTML = "";
    rows = [];
    let lastGroup = "";
    current.items.forEach((item, index) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const heading = document.createElement("div");
        heading.className = "truncate px-2 py-1 text-xs text-foreground-subtle";
        heading.textContent = item.group;
        container?.appendChild(heading);
      }
      const row = document.createElement("button");
      row.type = "button";
      // 高亮态由 `paint()` 统一给：这里只铺不变的那部分
      row.className =
        "flex w-full items-center gap-2 rounded-xs px-2 py-1 text-left text-sm text-foreground-subtle";
      // 名称占满剩余宽度、描述收一档：两者都单行截断，菜单行高不随文案变化
      const name = document.createElement("span");
      name.className = "min-w-0 flex-1 truncate";
      name.textContent = item.label;
      row.appendChild(name);
      if (item.hint) {
        const hint = document.createElement("span");
        // 描述贴右、最多占一半宽度：不设上限时它会靠 flex 压缩把名称挤没（实测被挤到 0 宽）
        hint.className =
          "ml-auto min-w-0 max-w-[50%] shrink-0 truncate text-xs text-foreground-subtle";
        hint.textContent = item.hint;
        row.appendChild(hint);
      }
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        select(index);
      });
      container?.appendChild(row);
      rows.push(row);
    });
    paint();
  };

  const place = (): void => {
    if (!container || !current) return;
    const margin = 8;
    // 宽度与左缘跟随输入卡（编辑器所在的卡片节点）：写死宽度会与 composer 对不齐
    const cardRect = current.editor?.view.dom.parentElement?.getBoundingClientRect() ?? null;
    const rect = cardRect ?? current.clientRect?.() ?? null;
    if (!rect) return;
    if (cardRect)
      container.style.width = `${Math.min(cardRect.width, window.innerWidth - margin * 2)}px`;
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    // 左右收边到视口内
    const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
    // 输入区在屏幕底部：优先向上展开，避免压住底部工具栏；上方放不下再向下
    const above = rect.top - height - 6;
    const top = above >= margin ? above : rect.bottom + 6;
    container.style.left = `${Math.max(margin, left)}px`;
    container.style.top = `${Math.max(margin, top)}px`;
  };

  const select = (index: number): void => {
    const item = current?.items[index];
    if (item) current?.command(item);
  };

  return {
    onStart: (props: RendererProps): void => {
      current = props;
      selected = 0;
      container = document.createElement("div");
      container.className =
        "fixed z-50 max-h-64 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-popover";
      document.body.appendChild(container);
      render();
      place();
      onActiveChange?.(props.items.length > 0);
    },
    onUpdate: (props: RendererProps): void => {
      current = props;
      selected = 0;
      render();
      place();
      onActiveChange?.(props.items.length > 0);
    },
    onKeyDown: (props: { event: KeyboardEvent }): boolean => {
      const count = current?.items.length ?? 0;
      switch (suggestionKeyActionOf(props.event, count)) {
        case "next":
          selected = stepIndex(selected, 1, count);
          paint();
          return true;
        case "previous":
          selected = stepIndex(selected, -1, count);
          paint();
          return true;
        case "select":
          select(selected);
          return true;
        case "dismiss":
          return true;
        default:
          return false;
      }
    },
    onExit: (): void => {
      container?.remove();
      container = null;
      current = null;
      onActiveChange?.(false);
    },
  };
};
