/** 决策区：权限审批、提问与计划决策共用的容器，出现时替掉输入区的位置 */
import type { ReactNode } from "react";

type DecisionAreaProps = {
  children: ReactNode;
};

/**
 * 三处「等用户决策」共用这一个外形：与对话列同宽、贴着输入区的位置出现，不再占满整屏。
 * 内边距与排布由内容自己决定——权限是「对象 + 三个结论」，问答与计划是「正文 + 底部按钮」。
 */
export function DecisionArea({ children }: DecisionAreaProps) {
  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-xl bg-popover ring-1 ring-foreground/10">{children}</div>
      </div>
    </div>
  );
}
