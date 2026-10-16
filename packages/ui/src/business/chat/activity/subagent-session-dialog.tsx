/**
 * 子智能体详情小窗：在对话区内查看子会话的完整往来，不离开当前会话。
 *
 * 函数式入口 `openSubagentSessionDialog`；挂载即打开，不再受控 `open`。
 */
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../base/dialog";
import { useSessionStream } from "../../../hooks/store/use-session-stream";
import { useActiveSession } from "../../../hooks/use-active-session";
import { openDialog } from "../../dialog/queue";
import { sessionTitle } from "../../session/session";
import { MessageList } from "../message/message-list";

type SubagentSessionDialogProps = {
  /** 要查看的子会话 id */
  sessionId: string;
  /** 关闭小窗；会话已归档或 id 失效时也会被调用 */
  onClose: () => void;
};

export function SubagentSessionDialog({ sessionId, onClose }: SubagentSessionDialogProps) {
  const { t } = useTranslation();
  // 子会话不在侧栏列表里，摘要经 `sessions/info` 补齐；拿不到摘要说明它已经不可用，直接收起
  const session = useActiveSession(sessionId, onClose);
  const stream = useSessionStream(sessionId);
  // 子会话不会被自动命名（标题服务只管主会话），所以未命名时回落委派任务的首句：
  // 全部叫「子会话」等于没标题，而任务首句能说清这个子代理在干什么
  const fallback = session?.preview.split("\n")[0]?.slice(0, 40) || t("子会话");
  const name = session ? sessionTitle(session, fallback) : t("子会话");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("子智能体")} · {name}
          </DialogTitle>
          <DialogDescription>
            {t("子会话是委派产生的独立对话，只能查看；需要它继续请在父会话里说明。")}
          </DialogDescription>
        </DialogHeader>

        {/* 高度写死一段：小窗里的列表自己滚，不跟着内容长高 */}
        <div className="flex h-[60vh] min-h-0 flex-col">
          <MessageList
            items={stream.items}
            subagents={stream.subagents}
            loading={stream.loadingHistory}
            working={stream.running}
            compacting={stream.compacting}
            phase={stream.phase}
            resetKey={sessionId}
            empty={<p className="text-sm text-foreground-subtle">{t("还没有内容")}</p>}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 打开子会话详情小窗；关闭时完成 */
export const openSubagentSessionDialog = (sessionId: string): Promise<void> =>
  openDialog((close) => (
    <SubagentSessionDialog sessionId={sessionId} onClose={() => close()} />
  )).then(() => undefined);
