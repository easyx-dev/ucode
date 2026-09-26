import type { ReactNode } from "react";

/**
 * 基础件（shadcn 的写法：Tailwind 类名 + 语义化 props，不引入运行时依赖）。
 *
 * 只做壳子真正需要的几个：按钮、卡片、输入、徽标、弹层。视觉上以 ZCode 为蓝本：
 * 深色、低饱和、信息密度高、动效克制。
 */

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
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
}): ReactNode {
  const base =
    "inline-flex items-center justify-center gap-1 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm";
  const variants = {
    primary:
      "border-transparent bg-[var(--color-accent)] text-[oklch(0.18_0.02_260)] hover:brightness-110",
    ghost:
      "border-[var(--color-border-subtle)] bg-transparent text-[var(--color-content)] hover:bg-[var(--color-surface-overlay)]",
    danger: "border-transparent bg-[var(--color-danger)] text-white hover:brightness-110",
  } as const;
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${sizes} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "warn" | "danger";
}): ReactNode {
  const tones = {
    muted: "bg-[var(--color-surface-overlay)] text-[var(--color-content-muted)]",
    accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    warn: "bg-[oklch(0.34_0.06_80)] text-[var(--color-warn)]",
    danger: "bg-[oklch(0.34_0.08_25)] text-[var(--color-danger)]",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-4 ${tones[tone]}`}
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
      className={`rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Modal({ children, title }: { children: ReactNode; title: string }): ReactNode {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] shadow-2xl">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3 text-sm font-medium">
          {title}
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

export function Spinner(): ReactNode {
  return (
    <span className="inline-block size-3 animate-pulse rounded-full bg-[var(--color-accent)] align-middle" />
  );
}
