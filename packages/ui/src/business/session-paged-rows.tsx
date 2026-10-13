/** 会话行的增量分页：默认放出一页，底部「加载更多」按页递增 */
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../base/button";
import type { SessionSummary } from "../lib/types";

/** 每次放出的会话条数 */
const PAGE_SIZE = 10;

type SessionPagedRowsProps = {
  sessions: SessionSummary[];
  /** 当前选中会话；排在已放出部分之后时自动展开到它 */
  activeId: string | null;
  /** 渲染一行；由上层统一带上选中态与子会话下钻数据 */
  renderItem: (session: SessionSummary) => ReactNode;
};

export function SessionPagedRows({ sessions, activeId, renderItem }: SessionPagedRowsProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(PAGE_SIZE);
  /** 从命令面板、搜索或子会话下钻进来的会话可能排在很后面，选了却看不见就等于没选 */
  const activeIndex = sessions.findIndex((session) => session.id === activeId);
  const visible = Math.max(loaded, activeIndex + 1);

  return (
    <>
      {sessions.slice(0, visible).map((session) => renderItem(session))}
      {visible < sessions.length ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs font-normal text-foreground-subtle hover:bg-transparent"
          onClick={() => setLoaded((current) => current + PAGE_SIZE)}
        >
          {t("加载更多")}
        </Button>
      ) : null}
    </>
  );
}
