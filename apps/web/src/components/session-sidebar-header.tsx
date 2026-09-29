/** 侧栏头部：品牌标识、新建会话入口与搜索框 */
import { brand } from "@ucode/brand";
import { MessageSquarePlus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SessionSidebarHeaderProps = {
  query: string;
  /** 未配置模型时禁止新建 */
  canCreate: boolean;
  onQueryChange: (query: string) => void;
  onCreate: () => void;
};

export function SessionSidebarHeader({
  query,
  canCreate,
  onQueryChange,
  onCreate,
}: SessionSidebarHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3">
        <BrandLogo className="size-5" />
        <span className="text-sm font-semibold tracking-tight">{brand.name}</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={onCreate}
          disabled={!canCreate}
          title={t("新建会话")}
        >
          <MessageSquarePlus className="size-4" />
          {t("新建")}
        </Button>
      </div>

      <div className="relative px-3 pb-2">
        <Search className="absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("搜索会话")}
          className="h-8 pl-7 text-xs"
        />
      </div>
    </>
  );
}
