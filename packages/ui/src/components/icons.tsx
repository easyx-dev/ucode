import type { ReactNode } from "react";

/**
 * 图标集：手写的 24 格线稿（`stroke: currentColor`），不引第三方图标库。
 *
 * 只挑壳子真正用到的那几个——图标是"一眼认路"的锚点（新建 / 搜索 / 面板 / 状态），
 * 用 emoji 或文字代替会让工具栏在深色底上糊成一片。
 */

type IconProps = { className?: string };

function Frame({ children, className = "size-4" }: IconProps & { children: ReactNode }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function PlusIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M12 5v14M5 12h14" />
    </Frame>
  );
}

export function SearchIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Frame>
  );
}

export function BoltIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M13.5 3 5.5 13H11l-.5 8 8-10H13l.5-8Z" />
    </Frame>
  );
}

export function PackageIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M12 3 4 7.2v9.6L12 21l8-4.2V7.2L12 3Z" />
      <path d="M4 7.2 12 11.5l8-4.3M12 11.5V21" />
    </Frame>
  );
}

export function GaugeIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-6" />
    </Frame>
  );
}

export function FolderIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17V7.5Z" />
    </Frame>
  );
}

export function TerminalIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M7.5 10l2 2-2 2M12.5 14h4" />
    </Frame>
  );
}

export function CompressIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M9 3.5V8a1 1 0 0 1-1 1H3.5M20.5 9H16a1 1 0 0 1-1-1V3.5M15 20.5V16a1 1 0 0 1 1-1h4.5M3.5 15H8a1 1 0 0 1 1 1v4.5" />
    </Frame>
  );
}

export function StopIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    </Frame>
  );
}

export function PanelIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M15 4.5v15" />
    </Frame>
  );
}

export function CloseIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Frame>
  );
}

export function ChevronDownIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M6 9.5l6 6 6-6" />
    </Frame>
  );
}

export function ChevronRightIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M9.5 6l6 6-6 6" />
    </Frame>
  );
}

export function CheckIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Frame>
  );
}

export function CopyIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
    </Frame>
  );
}

export function ArrowUpIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
    </Frame>
  );
}

export function SlidersIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Frame>
  );
}

export function ArchiveIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1" />
      <path d="M5.5 8.5v9.5A1.5 1.5 0 0 0 7 19.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4" />
    </Frame>
  );
}

export function ForkIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M12 7.5v3.5M6 16.5v-3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3" />
    </Frame>
  );
}

export function ShieldIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M12 3.5l7 2.8v5.4c0 4-3 7-7 8.8-4-1.8-7-4.8-7-8.8V6.3l7-2.8Z" />
    </Frame>
  );
}

export function FileTextIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M7 3.5h6L18 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M13 3.5V9h5M9.5 13h5M9.5 16.5h3" />
    </Frame>
  );
}

export function PencilIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M4 20l4.5-1.2L20 7.3a2 2 0 0 0-2.8-2.8L5.2 15.9 4 20Z" />
      <path d="M15.5 6.5l2.8 2.8" />
    </Frame>
  );
}

export function ListIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M4 7h10M4 12h10M4 17h7" />
      <path d="M16 16.5l2 2 3.5-4" />
    </Frame>
  );
}

export function PlugIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M9 3.5V8M15 3.5V8" />
      <path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8Z" />
      <path d="M12 16.5V20.5" />
    </Frame>
  );
}

export function AlertIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M12 4.5 21 19.5H3l9-15Z" />
      <path d="M12 10v4M12 16.8v.2" />
    </Frame>
  );
}

export function RefreshIcon(props: IconProps): ReactNode {
  return (
    <Frame {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V10h-5.5" />
    </Frame>
  );
}
