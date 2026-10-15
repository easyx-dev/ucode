/**
 * 终端视图：编辑器区里的一块 xterm 画面。
 *
 * 结束态在这里收口——进程退出后画面仍是最后那一屏（好让人看清报错），下面补一条说明；
 * 终端不会自己重启，重开由侧栏列表或标签重新打开来完成。输出流被判终态（终端已不存在、
 * 凭证失效）时同样补一条说明并给一次重连：那种情况下画面冻在最后一帧，不给入口只能刷新页面。
 */
import { useTranslation } from "react-i18next";

import { Button } from "../../../base/button";
import { useTokenNumber } from "../../../hooks/use-token-number";
import { TerminalBoundary } from "./terminal-boundary";
import { useTerminalInstance } from "./use-terminal-instance";
import { type TerminalLost, useTerminalSession } from "./use-terminal-session";
import { useTerminalTheme } from "./use-terminal-theme";

/** 失联提示：两种终态能不能救回来不一样，话也得不一样；短文案进提示条，细节留给悬停 */
const LOST_NOTICE: Record<TerminalLost, { text: string; detail: string }> = {
  gone: {
    text: "终端已不存在", // i18n-ignore
    detail: "可能已被关闭，或服务重启过", // i18n-ignore
  },
  unauthorized: {
    text: "终端连接被拒绝", // i18n-ignore
    detail: "登录凭证已失效，重新登录后再试", // i18n-ignore
  },
};

export function TerminalView({ terminalId }: { terminalId: string }) {
  return (
    <TerminalBoundary>
      <TerminalSurface terminalId={terminalId} />
    </TerminalBoundary>
  );
}

/** 真正画终端的那一层：出错由 `TerminalBoundary` 兜住，这里只管正常路径 */
function TerminalSurface({ terminalId }: { terminalId: string }) {
  const { t } = useTranslation();
  const theme = useTerminalTheme();
  // 与 diff 行同档（基准的 6/7）：代码面统一一个字号
  const fontSize = useTokenNumber("--font-size-base", 14) * (6 / 7);
  const { containerRef, terminal } = useTerminalInstance({ terminalId, fontSize, theme });
  const { exitCode, lost, reconnect } = useTerminalSession({ terminalId, terminal });
  // 失联文案按查表取：key 是动态值，这里按需收窄 t 的签名
  const translate = t as (key: string) => string;
  const notice = lost === null ? null : LOST_NOTICE[lost];
  const exitNotice =
    exitCode === null ? null : t("终端已结束（退出码 {{code}}）", { code: String(exitCode) });

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface">
      <div ref={containerRef} className="min-h-0 flex-1 px-3 py-2" />
      {exitNotice === null && notice === null ? null : (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-foreground-subtle">
          <span
            className="min-w-0 flex-1 truncate"
            title={notice ? translate(notice.detail) : undefined}
          >
            {exitNotice ?? (notice ? translate(notice.text) : null)}
          </span>
          {notice === null ? null : (
            <Button size="xs" variant="ghost" onClick={reconnect}>
              {t("重新连接")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
