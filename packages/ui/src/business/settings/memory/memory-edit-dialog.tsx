/**
 * 记忆编辑弹层：改一条已有记忆的标题与正文。函数式入口 `openMemoryEditDialog`，组件本体只管表单。
 *
 * 只改已有条目——新建留给模型侧的「记住」；弹层因此没有「新建」态，标题与正文都必须非空。
 * 文件名不在这里改：它是记忆回顾记录指向这条记忆的凭据（见 `server/.../memory/store.ts`）。
 */
import { useState } from "react";
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
import { openDialog } from "../../dialog/queue";

/** 多行输入：与设置页其它表单同一套 token（同 `mcp-server-form-dialog`） */
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-foreground-subtle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

/** 一条记忆的编辑内容；`title` 进索引行，`content` 是**不含首行标题**的正文 */
export type MemoryFactDraft = {
  title: string;
  content: string;
};

/**
 * 表单里编辑的是事实正文，不含首行的 `# 标题`：服务端写回时会按标题重新写上首行
 * （见 `harness/features/memory/store.ts` 的 `writeFactInDir`），连标题一起编辑会让它在正文里滚雪球。
 */
const bodyOf = (content: string): string => content.replace(/^#[^\n]*\n+/, "").trim();

type MemoryEditDialogProps = {
  initial: MemoryFactDraft;
  /** 事实文件名，只用于展示「改的是哪一条」 */
  file: string;
  onSubmit: (draft: MemoryFactDraft) => void;
  onCancel: () => void;
};

export function MemoryEditDialog({ initial, file, onSubmit, onCancel }: MemoryEditDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(() => bodyOf(initial.content));

  const valid = title.trim().length > 0 && content.trim().length > 0;

  const submit = (): void => {
    if (!valid) return;
    onSubmit({ title: title.trim(), content: content.trim() });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("编辑记忆")}</DialogTitle>
          <DialogDescription>
            {t(
              "标题会写进索引行，正文是给模型看的事实；保存在本机，新会话与重装后的会话会带上它。",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground-subtle">{t("标题")}</Label>
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground-subtle">{t("正文")}</Label>
            <textarea
              className={TEXTAREA_CLASS}
              rows={12}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <p className="text-xs text-foreground-subtle">{t("文件 {{file}}", { file })}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("取消")}
          </Button>
          <Button disabled={!valid} onClick={submit}>
            {t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 打开记忆编辑弹层；返回改后的标题与正文，取消返回 undefined */
export const openMemoryEditDialog = (input: {
  file: string;
  title: string;
  content: string;
}): Promise<MemoryFactDraft | undefined> =>
  openDialog<MemoryFactDraft>((close) => (
    <MemoryEditDialog
      file={input.file}
      initial={{ title: input.title, content: input.content }}
      onSubmit={(draft) => close(draft)}
      onCancel={() => close()}
    />
  ));
