import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Spinner } from "./spinner";

/** 类型色统一取语义 token：10% 淡底 + 本色文字（与 DESIGN.md 的错误态同口径） */
const TONE_VARS = {
  "--success-bg": "color-mix(in oklab, var(--success) 10%, var(--popover))",
  "--success-border": "color-mix(in oklab, var(--success) 40%, transparent)",
  "--success-text": "var(--success)",
  "--info-bg": "color-mix(in oklab, var(--info) 10%, var(--popover))",
  "--info-border": "color-mix(in oklab, var(--info) 40%, transparent)",
  "--info-text": "var(--info)",
  "--warning-bg": "color-mix(in oklab, var(--warning) 10%, var(--popover))",
  "--warning-border": "color-mix(in oklab, var(--warning) 40%, transparent)",
  "--warning-text": "var(--warning)",
  "--error-bg": "color-mix(in oklab, var(--destructive) 10%, var(--popover))",
  "--error-border": "color-mix(in oklab, var(--destructive) 40%, transparent)",
  "--error-text": "var(--destructive)",
} as const;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // 类型底色要 richColors 打开才会用下面这几个变量，否则四种类型全长一个样
      richColors
      icons={{
        success: <CircleCheckIcon className="size-icon-base" />,
        info: <InfoIcon className="size-icon-base" />,
        warning: <TriangleAlertIcon className="size-icon-base" />,
        error: <OctagonXIcon className="size-icon-base" />,
        loading: <Spinner className="size-icon-base" />,
      }}
      style={
        {
          ...TONE_VARS,
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
