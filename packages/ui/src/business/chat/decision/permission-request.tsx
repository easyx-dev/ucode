/** 权限审批：工具调用命中 `ask` 规则时，由用户决定放行范围 */
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import type { PermissionDecision, PermissionInteraction } from "../../../types";
import { DecisionHeader } from "./decision-panel";

type PermissionRequestProps = {
  request: PermissionInteraction;
  onRespond: (requestId: string, decision: PermissionDecision) => void;
};

export function PermissionRequest({ request, onRespond }: PermissionRequestProps) {
  const { t } = useTranslation();

  return (
    <>
      <DecisionHeader
        icon={TriangleAlert}
        title={t("需要权限")}
        source={
          request.sourceSessionId
            ? t("来自子智能体「{{description}}」", {
                description: request.sourceDescription ?? request.sourceSessionId,
              })
            : undefined
        }
      />

      <div className="space-y-2 px-3 py-2.5">
        <p className="text-xs text-foreground-subtle">
          {t("agent 想调用「{{tool}}」，操作对象：", { tool: request.tool })}
        </p>

        <code className="block max-h-32 overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap">
          {request.subject}
        </code>
      </div>

      <div className="flex items-center gap-2 px-3 pb-3">
        {/* 范围写在按钮同排：它决定「本会话恒允」到底放行了什么 */}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-subtle">
          {t("授权范围：{{scope}}", { scope: request.scope })}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onRespond(request.requestId, "deny")}>
          {t("拒绝")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRespond(request.requestId, "allow_once")}
        >
          {t("允许一次")}
        </Button>
        <Button size="sm" onClick={() => onRespond(request.requestId, "allow_session")}>
          {t("本会话恒允")}
        </Button>
      </div>
    </>
  );
}
