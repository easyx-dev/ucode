/**
 * 决策面板：权限审批、提问与计划决策共用的外形——绝对定位盖在输入区上，把输入区挡住。
 *
 * 分两层：先给输入区整段铺一层底衬（面板未必盖得住整段的每一处，露出来的地方必须是干净的，
 * 否则会看到输入区的上边框与没被盖住的按钮），面板再浮在底衬上、与整段下沿留出间距。
 * 底衬接住事件，输入区这段时间不响应；面板更高时向上撑开盖住对话尾部，限高后内部滚动。
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type DecisionPanelProps = {
  children: ReactNode;
};

export function DecisionPanel({ children }: DecisionPanelProps) {
  return (
    <>
      {/* 底衬：输入区整段（含它的上边框）都被它盖住，面板之外的点击也落在这里，不进输入区 */}
      <div aria-hidden className="absolute inset-0 z-10 bg-surface" />
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
        <div className="pointer-events-auto flex max-h-[70vh] w-full max-w-4xl flex-col overflow-y-auto rounded-xl bg-popover shadow-dialog ring-1 ring-border-strong">
          {children}
        </div>
      </div>
    </>
  );
}

type DecisionHeaderProps = {
  /** 决定这条决策的性质：审批、提问还是计划 */
  icon: LucideIcon;
  title: string;
  /** 发起方是子会话时的说明 */
  source?: string;
  /** 右侧补充（进度、状态） */
  extra?: ReactNode;
};

/** 面板头部：图标 + 标题 + 可选的来源与右侧补充 */
export function DecisionHeader({ icon: Icon, title, source, extra }: DecisionHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <Icon aria-hidden className="size-icon-sm shrink-0 text-warning" />
      <span className="shrink-0 text-xs font-medium">{title}</span>
      {source ? (
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-subtle">{source}</span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {extra}
    </div>
  );
}
