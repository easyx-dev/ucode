/** 远程访问与中继弹窗：侧栏页脚入口，分段切换两块「对外接入」配置 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../base/dialog";
import { SegmentedControl, type SegmentedOption } from "../../../base/segmented-control";
import { HubPanel } from "./hub-panel";
import { RemoteAccessPanel } from "./remote-access-panel";

type ServiceTab = "remote" | "hub";

type ServiceDialogProps = {
  /** 是否打开：关闭即卸载面板，取数与中继状态轮询一并停止 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ServiceDialog({ open, onOpenChange }: ServiceDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ServiceTab>("remote");
  const options = [
    { value: "remote", label: t("远程访问") },
    { value: "hub", label: t("中继") },
  ] as const satisfies ReadonlyArray<SegmentedOption<ServiceTab>>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 两块内容都长，弹窗限高后由正文自己滚动；底色用外壳色而不是弹窗色，内部卡片才立得起来 */}
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 bg-background p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 gap-2 border-b border-border px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-3 pr-12">
            <DialogTitle>{t("远程访问与中继")}</DialogTitle>
            <SegmentedControl
              label={t("远程访问与中继")}
              value={tab}
              options={options}
              onChange={setTab}
              className="sm:ml-auto"
            />
          </div>
          <DialogDescription>
            {tab === "remote"
              ? t(
                  "让同一网络下的设备接入本服务。通过鉴权的设备等于本机 owner，可驱动 agent 读写文件、执行命令。",
                )
              : t("把本机接入中继：登录后由服务维持隧道，中继侧的请求转给本机服务。")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {tab === "remote" ? <RemoteAccessPanel /> : <HubPanel />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
