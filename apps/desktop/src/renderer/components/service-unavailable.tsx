/** 服务不可用态：读不到注册文件、连不上或凭证失效时替代工作区 */

import { Button } from "@ucode/ui/base/button";
import { Empty } from "@ucode/ui/base/empty";
import type { TFunction } from "i18next";
import { ServerOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ServiceUnavailableReason = "missing" | "unreachable" | "unauthorized";

export type ServiceUnavailableProps = {
  /** missing：未找到注册文件；unreachable：连不上服务；unauthorized：找到但凭证失效 */
  reason: ServiceUnavailableReason;
  /** 服务注册文件路径，便于用户定位 */
  servicePath: string;
  /** 重走一遍启动流程（重读注册文件、探活、认证）；服务刚起来时靠它回到工作区 */
  onRetry: () => void;
};

/** 三种原因各自的下一步说明：读不到文件要去启服务，凭证失效要重启服务 */
const hintOf = (t: TFunction, reason: ServiceUnavailableReason, servicePath: string): string => {
  switch (reason) {
    case "missing":
      return t("未找到服务注册文件 {{path}}，请先启动服务。", { path: servicePath });
    case "unreachable":
      return t("无法连接本机服务，请确认服务已启动。");
    case "unauthorized":
      return t("服务凭证无效，请重启服务后重试。");
  }
};

export function ServiceUnavailable({ onRetry, reason, servicePath }: ServiceUnavailableProps) {
  const { t } = useTranslation();

  return (
    <Empty
      className="h-dvh w-full bg-background"
      icon={<ServerOff className="size-7" />}
      title={t("未连接到本机服务")}
      hint={hintOf(t, reason, servicePath)}
      action={
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("重试")}
        </Button>
      }
    />
  );
}
