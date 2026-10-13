/** 本地用户行：设置导航与侧栏页脚共用的身份区，用户名的来源集中在这里 */
import { cn } from "cn";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback } from "../../base/avatar";

type LocalUserRowProps = {
  /** 行尾动作，如侧栏的「设置」按钮；不传则只做身份展示 */
  action?: ReactNode;
  className?: string;
};

export function LocalUserRow({ action, className }: LocalUserRowProps) {
  const { t } = useTranslation();
  /** 用户名的来源（登录态 / 配置项）尚未确定，本轮先固定展示 */
  const localUserName = t("本地用户");

  return (
    <div className={cn("flex items-center gap-2 p-2", className)}>
      <Avatar className="size-7">
        <AvatarFallback className="text-xs">{localUserName.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{localUserName}</span>
      {action}
    </div>
  );
}
