/**
 * `/` 与 `@` 共用的建议下拉：原生 DOM 渲染并固定在光标下方。
 *
 * 用原生 DOM 而非 React 渲染，避免再引入定位库（tippy）；键盘导航与选中由这里统一处理，
 * 选中项原样交给 Tiptap suggestion 的 `command`。
 */
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
};

/**
 * 建议弹层的渲染工厂。
 * `onActiveChange` 在「有候选」时置真、关闭或候选为空时置假——编辑器据此把 Enter / 方向键
 * 让给弹层（否则会被发送逻辑抢走）。
 */
export const createSuggestionRenderer = (onActiveChange?: (active: boolean) => void) => () => {
  let container: HTMLDivElement | null = null;
  let current: RendererProps | null = null;
  let selected = 0;

  const render = (): void => {
    if (!container || !current) return;
    container.innerHTML = "";
    let lastGroup = "";
    current.items.forEach((item, index) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const heading = document.createElement("div");
        heading.className = "px-2 py-1 text-xs text-foreground-subtle";
        heading.textContent = item.group;
        container?.appendChild(heading);
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = `flex w-full items-center gap-2 rounded-xs px-2 py-1 text-left text-sm ${
        index === selected ? "bg-muted text-foreground" : "text-foreground-subtle"
      }`;
      const name = document.createElement("span");
      name.textContent = item.label;
      row.appendChild(name);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "ml-auto text-xs text-foreground-subtle";
        hint.textContent = item.hint;
        row.appendChild(hint);
      }
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        select(index);
      });
      container?.appendChild(row);
    });
  };

  const place = (): void => {
    if (!container || !current?.clientRect || !current.clientRect) return;
    const rect = current.clientRect();
    if (!rect) return;
    const margin = 8;
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
        "fixed z-50 max-h-64 w-80 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-popover";
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
      if (count === 0) return false;
      if (props.event.key === "ArrowDown") {
        selected = (selected + 1) % count;
        render();
        return true;
      }
      if (props.event.key === "ArrowUp") {
        selected = (selected - 1 + count) % count;
        render();
        return true;
      }
      if (props.event.key === "Enter") {
        select(selected);
        return true;
      }
      if (props.event.key === "Escape") return true;
      return false;
    },
    onExit: (): void => {
      container?.remove();
      container = null;
      current = null;
      onActiveChange?.(false);
    },
  };
};
