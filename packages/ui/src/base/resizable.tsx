import { cn } from "cn";
import * as ResizablePrimitive from "react-resizable-panels";

/**
 * 分栏容器。三个面板的组用 `orientation="horizontal"`（左右并排，分隔条是竖的）。
 * 尺寸单位沿用库的约定：数字是像素、字符串是百分比——本项目一律用像素，
 * 于是栏宽不随窗口变化（见 `utils/panel-layout`）。
 */
function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/**
 * 拖拽分隔条：只提供命中区，不画线——栏与栏之间靠底色差分层，分隔本身不可见。
 * 因此命中区要留够（默认 12px，可覆盖），并且必须给出聚焦态反馈，否则键盘用户看不到自己在哪。
 */
function ResizableHandle({ className, ...props }: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // 光标是唯一的悬停提示（库在拖拽期间还会给 data-separator 状态，需要时再挂样式）
        "relative flex w-3 shrink-0 cursor-col-resize items-center justify-center bg-transparent",
        "focus-visible:bg-ring/40 focus-visible:outline-hidden",
        className,
      )}
      {...props}
    />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
