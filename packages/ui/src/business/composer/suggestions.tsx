/** 空态的四条起手建议：卡下方的 chips，点击填进输入框（不直接发送） */
import { Bug, Compass, FlaskConical, type LucideIcon, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ComposerSuggestions({ onSelect }: { onSelect: (text: string) => void }) {
  const { t } = useTranslation();
  // 文案在本组件内取：中文只出现在 t() 里，硬编码中文校验才放行
  const items: { text: string; icon: LucideIcon }[] = [
    { text: t("了解这个项目"), icon: Compass },
    { text: t("排查构建报错"), icon: Bug },
    { text: t("补充单元测试"), icon: FlaskConical },
    { text: t("重构这段代码"), icon: Wrench },
  ];

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.text}
            type="button"
            onClick={() => onSelect(item.text)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Icon className="size-3.5" />
            {item.text}
          </button>
        );
      })}
    </div>
  );
}
