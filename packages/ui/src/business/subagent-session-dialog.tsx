/** 子智能体详情小窗：在对话区内查看子会话的完整往来，不离开当前会话 */
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../base/dialog";
import { useActiveSession } from "../hooks/use-active-session";
import { useSessionStream } from "../hooks/use-session-stream";
import { sessionTitle } from "../lib/session";
import { MessageList } from "./message-list";

type SubagentSessionDialogProps = {
  /** 要查看的子会话 id；为空即不展示 */
  sessionId: string | null;
  /** 关闭小窗；会话已归档或 id 失效时也会被调用 */
  onClose: () => void;
};

export function SubagentSessionDialog({ sessionId, onClose }: SubagentSessionDialogProps) {
  const { t } = useTranslation();
  // 子会话不在侧栏列表里，摘要经 `sessions/info` 补齐；拿不到摘要说明它已经不可用，直接收起
  const session = useActiveSession(sessionId, onClose);
  const stream = useSessionStream(sessionId);
  const name = session ? sessionTitle(session, t("子会话")) : t("子会话");

  return (
    <Dialog
      open={Boolean(sessionId)}
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
            resetKey={sessionId ?? ""}
            empty={<p className="text-sm text-muted-foreground">{t("还没有内容")}</p>}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
