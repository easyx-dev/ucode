/** 设置页的骨架：页头（标题 / 说明 / 动作 / 保存区）、区块标题与空态 */
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** 正文内容列：各分区页共用同一宽度，切页时不左右跳；两栏布局的模型设置也按它收口 */
export const SETTINGS_CONTENT_COLUMN = "mx-auto w-full max-w-4xl";

type SettingsPageHeaderProps = {
  /** 页面标题，同时是导航项的文案 */
  title: string;
  /** 页头说明：这一页管什么。行内说明已经讲清的分区不必再写一遍 */
  description?: string;
  /** 页面级动作，如模型页的「添加供应商」，落在说明行右侧 */
  action?: ReactNode;
  /** 标题行右侧的常驻区：草稿的「保存并生效 / 取消」。窄屏不渲染（顶部条里有保存入口） */
  trailing?: ReactNode;
};

export function SettingsPageHeader({
  title,
  description,
  action,
  trailing,
}: SettingsPageHeaderProps) {
  return (
    <header className="shrink-0 px-6 pt-6 pb-4 md:px-8">
      <div className={cn(SETTINGS_CONTENT_COLUMN, "flex items-start justify-between gap-3")}>
        <h2 className="font-heading text-2xl font-semibold">{title}</h2>
        {trailing ? (
          <div className="hidden shrink-0 items-center gap-2 md:flex">{trailing}</div>
        ) : null}
      </div>
      {description || action ? (
        <div className={cn(SETTINGS_CONTENT_COLUMN, "mt-2 flex items-start gap-4")}>
          {description ? (
            <p className="min-w-0 text-sm leading-relaxed text-foreground-subtle">{description}</p>
          ) : null}
          {/* 说明缺席时动作仍要落在右侧，故用 ml-auto 而不是 justify-between */}
          {action ? <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

type SettingsPageProps = {
  /** 页面标题，同时是导航项的文案 */
  title: string;
  /** 页头说明：这一页管什么。行内说明已经讲清的分区不必再写一遍 */
  description?: string;
  /** 标题行右侧的常驻区：草稿的「保存并生效 / 取消」 */
  trailing?: ReactNode;
  children: ReactNode;
};

/** 滚动式内容页。带页面级动作的分区（模型设置的两栏布局）自己用 SettingsPageHeader 排页头 */
export function SettingsPage({ title, description, trailing, children }: SettingsPageProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SettingsPageHeader title={title} description={description} trailing={trailing} />
      {/* 顶部留白给卡片的 ring 留余量：贴住裁切上边界时描边会被削掉 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-4 pb-8 md:px-8">
        <div className={SETTINGS_CONTENT_COLUMN}>{children}</div>
      </div>
    </div>
  );
}

type SettingsSectionHeaderProps = {
  title: string;
  /** 标题旁的元信息，如「3 项」「12 个」；调用方负责翻译 */
  meta?: ReactNode;
  /** 区块级动作，如「添加模型」 */
  action?: ReactNode;
  className?: string;
};

/** 区块标题：一页里分几段时用它分段（跟页面标题拉开两级） */
export function SettingsSectionHeader({
  title,
  meta,
  action,
  className,
}: SettingsSectionHeaderProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <h3 className="text-sm font-medium">{title}</h3>
      {meta ? <span className="text-sm text-foreground-subtle tabular-nums">{meta}</span> : null}
      {action ? <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

type SettingsEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** 下一步动作：空态必须给一个明确出口 */
  action?: ReactNode;
  className?: string;
};

/** 列表为空时的占位：虚线框内居中给出「这是什么、怎么开始」 */
export function SettingsEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: SettingsEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-9 text-center",
        className,
      )}
    >
      <Icon className="size-icon-lg text-foreground-subtle" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-foreground-subtle">{description}</p>
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
