/** 空态：未配置模型 / 还没有会话 / 已选会话但没有消息 */
import { brand } from "@ucode/brand";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { abbreviateHome } from "@/lib/path";

type WelcomePanelProps = {
  configured: boolean;
  /** 当前默认模型，"provider/model" */
  defaultModel: string | null;
  /** 是否已有任何会话 */
  hasSessions: boolean;
  /** agent 工作目录，来自 health；未取到时退回通用文案 */
  workspace: string | null;
  onCreate: () => void;
  onOpenSettings: () => void;
};

export function WelcomePanel({
  configured,
  defaultModel,
  hasSessions,
  workspace,
  onCreate,
  onOpenSettings,
}: WelcomePanelProps) {
  const { t } = useTranslation();

  /** 按当前时段问候；空对话是唯一用到「大标题 + 水印」的场合 */
  const greeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 6) return t("夜深了，接下来交给我吧");
    if (hour < 12) return t("早上好，接下来交给我吧");
    if (hour < 18) return t("下午好，接下来交给我吧");
    return t("晚上好，接下来交给我吧");
  };

  if (!configured) {
    return (
      <section className="flex flex-col items-center gap-3 py-12 text-center">
        <h2 className="text-xl font-semibold">{t("还没有配置模型")}</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t("未配置.说明")}</p>
        <Button onClick={onOpenSettings}>{t("打开设置")}</Button>
      </section>
    );
  }

  if (!hasSessions) {
    return (
      <section className="flex flex-col items-center gap-3 py-12 text-center">
        <h2 className="text-xl font-semibold">{t("开始第一个会话")}</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("就绪.说明", { model: defaultModel ?? "-" })}
          {workspace ? (
            <code className="mx-1 rounded-sm bg-muted px-1 font-mono text-xs break-all">
              {abbreviateHome(workspace)}
            </code>
          ) : (
            t("工作目录")
          )}
          {t("就绪.说明.后缀")}
        </p>
        <Button onClick={onCreate}>{t("新建会话")}</Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col items-center gap-4 py-12 text-center">
      {/* 水印是装饰，不参与朗读 */}
      <span
        aria-hidden
        className="pointer-events-none text-7xl font-semibold leading-none tracking-tighter text-foreground/5 select-none"
      >
        {brand.name}
      </span>
      <h2 className="text-xl font-semibold">{greeting()}</h2>
    </section>
  );
}
