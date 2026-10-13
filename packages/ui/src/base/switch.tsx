import { cn } from "cn";
import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=unchecked]:bg-secondary data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          /*
           * 滑块用 h-4 / w-4 而不是 size-icon-*：图标档位跟随字号，而滑块要与固定高度的轨道相称。
           * 位移是算出来的——轨道内宽（36 - 两侧各 1px 描边）= 34，减去滑块 16 得 18，
           * 未选中贴左 2px、选中贴右即 18 - 2 = 16。
           */
          "pointer-events-none block h-4 w-4 rounded-full bg-popover shadow-raised transition-transform",
          "data-[state=unchecked]:translate-x-0.5 data-[state=checked]:translate-x-4",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
