/** 插件安装对话框：五种来源各给一个输入位；安装成功即关闭，进度由父层的 plugin_progress 帧喂入 */
import type { PluginCreateRequest } from "@ucode/contracts";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../base/dialog";
import { Input } from "../../../base/input";
import { Label } from "../../../base/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../base/select";
import { Spinner } from "../../../base/spinner";

/** 安装来源：与安装入参的来源类型一一对应 */
type SourceKind = "directory" | "url" | "npm" | "github" | "git";

type PluginInstallDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (input: PluginCreateRequest) => Promise<boolean>;
  /** 安装 / 重拉的阶段提示（来自 plugin_progress 帧），完成后自动清空 */
  progress: string | null;
};

export function PluginInstallDialog({
  open,
  onOpenChange,
  onInstall,
  progress,
}: PluginInstallDialogProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [kind, setKind] = useState<SourceKind>("directory");
  const [value, setValue] = useState("");
  const [ref, setRef] = useState("");
  const [installing, setInstalling] = useState(false);

  const placeholder =
    kind === "directory"
      ? t("插件目录的绝对路径")
      : kind === "url"
        ? t("压缩包直链（.zip / .tgz）")
        : kind === "npm"
          ? t("包名，可带版本：@scope/name@1.2.3")
          : kind === "github"
            ? t("owner/repo")
            : t("Git 仓库地址");

  const submit = async (): Promise<void> => {
    const source = value.trim();
    if (!source) return;
    // 网络来源可能要拉几十秒：按钮先进入进行中状态，避免看不到反应重复点
    setInstalling(true);
    const input: PluginCreateRequest["source"] =
      kind === "directory"
        ? { source: "directory", path: source }
        : kind === "url"
          ? { source: "url", url: source }
          : kind === "npm"
            ? { source: "npm", package: source }
            : kind === "github"
              ? { source: "github", repo: source, ...(ref.trim() ? { ref: ref.trim() } : {}) }
              : { source: "git", url: source, ...(ref.trim() ? { ref: ref.trim() } : {}) };
    try {
      if (await onInstall({ source: input })) {
        setValue("");
        setRef("");
        onOpenChange(false);
      }
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("安装插件")}</DialogTitle>
          <DialogDescription>
            {t("本地目录来源不复制内容（改完重拉即可生效），网络来源会复制进插件缓存。")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-kind`}>{t("安装来源")}</Label>
            <Select value={kind} onValueChange={(next) => setKind(next as SourceKind)}>
              <SelectTrigger id={`${fieldId}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="directory">{t("本地目录")}</SelectItem>
                <SelectItem value="url">{t("压缩包链接")}</SelectItem>
                <SelectItem value="npm">{t("npm 包")}</SelectItem>
                <SelectItem value="github">{t("GitHub 仓库")}</SelectItem>
                <SelectItem value="git">{t("Git 仓库")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-source`}>{t("来源地址")}</Label>
            <Input
              id={`${fieldId}-source`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
            />
          </div>

          {kind === "github" || kind === "git" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-ref`}>{t("分支 / 标签")}</Label>
              <Input
                id={`${fieldId}-ref`}
                value={ref}
                onChange={(event) => setRef(event.target.value)}
                placeholder={t("留空用默认分支")}
              />
            </div>
          ) : null}

          {installing || progress ? (
            <p className="text-sm text-foreground-subtle">{progress ?? t("安装中…")}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={installing}>
            {t("取消")}
          </Button>
          <Button onClick={() => void submit()} disabled={!value.trim() || installing}>
            {installing ? <Spinner className="size-icon-sm" /> : null}
            {installing ? t("安装中…") : t("安装")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
