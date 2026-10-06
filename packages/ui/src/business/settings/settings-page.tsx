/** 设置页的页头与正文容器：页头固定，正文独立滚动 */
import type { ReactNode } from "react";

type SettingsPageHeaderProps = {
  /** 页面标题，同时是导航项的文案 */
  title: string;
  /** 页面级动作，如模型页的「添加供应商」 */
  action?: ReactNode;
};

export function SettingsPageHeader({ title, action }: SettingsPageHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6 md:px-8">
      <h2 className="truncate font-heading text-base font-medium">{title}</h2>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </header>
  );
}

type SettingsPageProps = SettingsPageHeaderProps & {
  children: ReactNode;
};

export function SettingsPage({ title, action, children }: SettingsPageProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPageHeader title={title} action={action} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6 md:p-8">{children}</div>
    </div>
  );
}
