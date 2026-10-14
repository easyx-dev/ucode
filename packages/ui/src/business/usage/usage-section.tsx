/** 仪表盘区块容器：统一的卡片外观、标题行与内容 */

import type { ReactNode } from "react";

type UsageSectionProps = {
  title: string;
  /** 标题右侧的补充说明 */
  hint?: string;
  /** 标题行右侧的动作，如口径切换 */
  action?: ReactNode;
  children: ReactNode;
};

export function UsageSection({ title, hint, action, children }: UsageSectionProps) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint ? <span className="text-xs text-foreground-subtle tabular-nums">{hint}</span> : null}
        {action ? <div className="ml-auto">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}
