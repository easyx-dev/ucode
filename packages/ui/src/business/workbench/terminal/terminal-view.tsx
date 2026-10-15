/**
 * 终端视图：编辑器区里的一块 xterm 画面。
 *
 * 结束态在这里收口——进程退出后画面仍是最后那一屏（好让人看清报错），下面补一条说明；
 * 终端不会自己重启，重开由侧栏列表或标签重新打开来完成。
 */
import { useTranslation } from "react-i18next";

import { useTokenNumber } from "../../../hooks/use-token-number";
import { TerminalBoundary } from "./terminal-boundary";
import { useTerminalInstance } from "./use-terminal-instance";
import { useTerminalSession } from "./use-terminal-session";
import { useTerminalTheme } from "./use-terminal-theme";

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
  const { exitCode } = useTerminalSession({ terminalId, terminal });

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface">
      <div ref={containerRef} className="min-h-0 flex-1 px-3 py-2" />
      {exitCode === null ? null : (
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-foreground-subtle">
          {t("终端已结束（退出码 {{code}}）", { code: String(exitCode) })}
        </div>
      )}
    </div>
  );
}
