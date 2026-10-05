/** 服务不可用态：读不到注册文件、连不上或凭证失效时替代工作区 */
import { useTranslation } from "react-i18next";

export type ServiceUnavailableReason = "missing" | "unreachable" | "unauthorized";

export type ServiceUnavailableProps = {
  /** missing：未找到注册文件；unreachable：连不上服务；unauthorized：找到但凭证失效 */
  reason: ServiceUnavailableReason;
  /** 服务注册文件路径，便于用户定位 */
  servicePath: string;
};

export function ServiceUnavailable({ reason, servicePath }: ServiceUnavailableProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h1 className="text-base font-medium text-foreground">{t("未连接到本机服务")}</h1>
      <p className="max-w-lg text-sm text-muted-foreground">
        {reason === "missing" &&
          t("未找到服务注册文件 {{path}}，请先启动服务。", { path: servicePath })}
        {reason === "unreachable" && t("无法连接本机服务，请确认服务已启动。")}
        {reason === "unauthorized" && t("服务凭证无效，请重启服务后重试。")}
      </p>
    </div>
  );
}
