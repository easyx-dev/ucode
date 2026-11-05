/**
 * 图表的 mermaid 源：图在正文里渲染出来之后，源文本就不再出现在页面上，这里给回看与复制的入口。
 *
 * 源码由调用方直接给（图源来自消息正文），不重新解析；挂载即打开，收起即结算。
 */
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../base/dialog";
import { openDialog } from "../../dialog/queue";
import { CodeBlock } from "../code/code-block";

export function MermaidSourceDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("图表原代码")}</DialogTitle>
          <DialogDescription>
            {t("这张图由下面这段 mermaid 源渲染，可直接复制。")}
          </DialogDescription>
        </DialogHeader>
        {/* 高度写死一段：长序列图也只让源码自己滚，不把弹层撑到整屏；字号取正文代码块那一档 */}
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
          {/* 语言表里有 mermaid 语法，高亮未就绪时会先铺纯文本（`CodeBlock` 自己处理） */}
          <CodeBlock code={code} deferred={false} language="mermaid" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 打开图表原代码弹层 */
export const openMermaidSourceDialog = (code: string): void => {
  void openDialog((close) => <MermaidSourceDialog code={code} onClose={() => close()} />);
};
