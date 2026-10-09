/**
 * 空态：还没有任何消息时的起点（输入区常驻可用，直接打字就是第一个会话）。
 *
 * 只有品牌图与一句按时段的问候——模型在工具栏、工作目录在项目条，这里再说一遍是重复。
 */
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import { BrandLogo } from "./brand-logo";

type WelcomePanelProps = {
  configured: boolean;
  onOpenSettings: () => void;
};

export function WelcomePanel({ configured, onOpenSettings }: WelcomePanelProps) {
  const { t } = useTranslation();

  if (!configured) {
    return (
      <section className="flex flex-col items-center gap-3 py-12 text-center">
        <h2 className="text-xl font-semibold">{t("还没有配置模型")}</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("填入一个 OpenAI 兼容端点（baseUrl / apiKey / 模型 id）后即可开始对话。")}
        </p>
        <Button onClick={onOpenSettings}>{t("打开设置")}</Button>
      </section>
    );
  }

  /** 按当前时段问候；空态是唯一用到「品牌图 + 大标题」的场合 */
  const greeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 6) return t("深夜好呀，有什么想让我帮忙的吗");
    if (hour < 12) return t("上午好呀，有什么想让我帮忙的吗");
    if (hour < 18) return t("下午好呀，有什么想让我帮忙的吗");
    return t("晚上好呀，有什么想让我帮忙的吗");
  };

  return (
    <section className="flex flex-col items-center gap-4 pb-8 text-center">
      {/* 水印是装饰，不参与朗读 */}
      <BrandLogo className="h-20 opacity-[0.07]" />
      <h2 className="text-xl font-semibold">{greeting()}</h2>
    </section>
  );
}
