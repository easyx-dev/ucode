import { type ReactNode, useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, CloseIcon } from "./icons.tsx";

/**
 * 基础件（shadcn 的写法：Tailwind 类名 + 语义化 props，不引入运行时依赖）。
 *
 * 视觉口径：深色、低饱和、信息密度高、动效克制。颜色一律走 `styles.css` 的语义 token，
 * 组件里不出现色值——换主题只改 token，不用翻组件。
 */

type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-3 text-xs",
};

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-accent-foreground)] hover:bg-[var(--color-accent-hover)]",
  ghost:
    "border border-[var(--color-border-subtle)] text-[var(--color-content)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-overlay)]",
  subtle:
    "bg-[var(--color-surface-overlay)] text-[var(--color-content)] hover:bg-[var(--color-border-subtle)]",
  danger:
    "bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white",
};

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled,
  title,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}): ReactNode {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** 纯图标按钮（工具栏用）：`label` 同时是 tooltip 与无障碍名。 */
export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        active
          ? "bg-[var(--color-surface-overlay)] text-[var(--color-content)]"
          : "text-[var(--color-content-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-content)]"
      } ${className}`}
    >
      {icon}
    </button>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "warn" | "danger" | "success";
}): ReactNode {
  const tones = {
    muted: "bg-[var(--color-surface-overlay)] text-[var(--color-content-muted)]",
    accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
    danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] leading-4 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      className={`rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] ${className}`}
    >
      {children}
    </div>
  );
}

/** 快捷键提示（侧栏导航用）：终端习惯的按键小帽。 */
export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return (
    <kbd className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-1 text-[10px] font-normal text-[var(--color-content-faint)]">
      {children}
    </kbd>
  );
}

/** 分段控件（页签）：比一排按钮更像"同一组里选一个"。 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}): ReactNode {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-[var(--color-surface)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
            option.value === value
              ? "bg-[var(--color-surface-overlay)] text-[var(--color-content)]"
              : "text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type MenuItem = {
  value: string;
  label: string;
  /** 第二行的解释（"这个选项是什么意思"）——选择类菜单的价值主要在这一行。 */
  description?: string;
  checked?: boolean;
  disabled?: boolean;
};

/**
 * 下拉菜单（触发器 + 浮层）。
 *
 * 只用得到两种方向：输入区与状态条在底部，因此菜单**向上**弹。点击外部、Esc、选中都会关闭——
 * 少一条都会让用户以为菜单"卡住了"。
 */
export function Menu({
  label,
  items,
  onSelect,
  title,
  direction = "down",
  align = "start",
  width = "w-72",
  className = "",
}: {
  label: ReactNode;
  items: readonly MenuItem[];
  onSelect: (value: string) => void;
  title?: string;
  direction?: "up" | "down";
  align?: "start" | "end";
  width?: string;
  className?: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (wrapper.current !== null && !wrapper.current.contains(event.target as Node))
        setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapper} className={`relative ${className}`}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors ${
          open
            ? "bg-[var(--color-surface-overlay)] text-[var(--color-content)]"
            : "text-[var(--color-content-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-content)]"
        }`}
      >
        {label}
        <ChevronDownIcon className="size-3" />
      </button>
      {open && (
        <div
          className={`absolute z-50 ${width} ${
            direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${align === "end" ? "right-0" : "left-0"} rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] p-1 shadow-xl`}
        >
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              disabled={item.disabled === true}
              onClick={() => {
                setOpen(false);
                onSelect(item.value);
              }}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-raised)] disabled:pointer-events-none disabled:opacity-40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-[var(--color-content)]">
                  {item.label}
                </span>
                {item.description !== undefined && (
                  <span className="mt-0.5 block text-[11px] text-[var(--color-content-muted)]">
                    {item.description}
                  </span>
                )}
              </span>
              {item.checked === true && (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--color-accent)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Modal({
  children,
  title,
  onClose,
}: {
  children: ReactNode;
  title: string;
  onClose?: () => void;
}): ReactNode {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <span className="text-sm font-medium">{title}</span>
          {onClose !== undefined && (
            <IconButton className="ml-auto" icon={<CloseIcon />} label="关闭" onClick={onClose} />
          )}
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3.5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ className = "size-3" }: { className?: string }): ReactNode {
  return (
    <span
      className={`inline-block ${className} animate-spin rounded-full border border-[var(--color-accent)] border-t-transparent align-middle`}
    />
  );
}

/**
 * 侧栏/面板的统一外壳：标题行 + 可滚动正文。
 *
 * 右侧那几个面板（工作区 / 自动化 / 插件 / 用量）结构完全一样，各写一遍的结果就是
 * 边距、高度、关闭按钮位置各自漂移——那些漂移单看一个面板看不出来，四个并排就很明显。
 */
export function Panel({
  title,
  icon,
  actions,
  onClose,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}): ReactNode {
  return (
    <aside
      className={`app-rail flex w-96 shrink-0 flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] ${className}`}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
        {icon !== undefined && <span className="text-[var(--color-content-muted)]">{icon}</span>}
        <span className="truncate text-xs font-medium">{title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          {onClose !== undefined && (
            <IconButton icon={<CloseIcon />} label="关闭面板" onClick={onClose} />
          )}
        </div>
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
    </aside>
  );
}
