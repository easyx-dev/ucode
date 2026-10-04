/** 权限审批弹窗：工具调用命中 `ask` 规则时，由用户决定放行范围 */
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PermissionDecision, PermissionInteraction } from "@/lib/types";

type PermissionDialogProps = {
  /** 当前待答的权限审批；为空或不是审批时不展示 */
  request: PermissionInteraction | null;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
};

export function PermissionDialog({ request, onRespond }: PermissionDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={Boolean(request)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("需要授权")}</DialogTitle>
          <DialogDescription>
            {request?.sourceSessionId ? (
              <span className="mb-1 block text-xs text-muted-foreground">
                {t("来自子智能体「{{description}}」的请求：", {
                  description: request.sourceDescription ?? request.sourceSessionId,
                })}
              </span>
            ) : null}
            {t("agent 想调用「{{tool}}」，操作对象：", { tool: request?.tool ?? "" })}
            <code className="mt-1 block max-h-32 overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap">
              {request?.subject}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="text-xs text-muted-foreground">
          {t("授权范围：{{scope}}", { scope: request?.scope ?? "" })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => request && onRespond(request.requestId, "deny")}>
            {t("拒绝")}
          </Button>
          <Button
            variant="outline"
            onClick={() => request && onRespond(request.requestId, "allow_once")}
          >
            {t("允许一次")}
          </Button>
          <Button onClick={() => request && onRespond(request.requestId, "allow_session")}>
            {t("本会话恒允")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
