/**
 * 「+」菜单：只列真的有行为的入口——附件与技能。
 *
 * 工作流、插件市场、远程连接都不出现（没有实现，摆一个点了没反应的入口比少两行更糟）。
 */
import { Paperclip, Plus, Sparkles } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../base/dropdown-menu";
import { useCommands } from "../../hooks/use-commands";
import { PICKER_TRIGGER_CLASS, usePickerCloseFocus } from "../picker-options";

type AddMenuProps = {
  sessionId: string | null;
  /** 真实工作目录，技能清单按它取 */
  cwdPath?: string;
  onFiles: (files: File[]) => void;
  /** 插入命令 / 技能节点；正文开头已有一条时返回 false */
  onInsertCommand: (command: { kind: "prompt" | "skill"; name: string }) => boolean;
  /** 弹层关掉后把焦点交给谁（输入区传编辑器）；点在别处时不会调它 */
  onRefocus?: () => void;
};

export function AddMenu({ sessionId, cwdPath, onFiles, onInsertCommand, onRefocus }: AddMenuProps) {
  const { t } = useTranslation();
  const commands = useCommands(sessionId, cwdPath);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const closeFocus = usePickerCloseFocus(onRefocus);

  const handlePick = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    // 清掉选择记录：同一批文件再选一次也要能触发 change
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  };

  const insertSkill = (name: string): void => {
    if (!onInsertCommand({ kind: "skill", name })) {
      toast.info(t("正文开头已经有一条命令或技能"));
    }
  };

  return (
    <>
      <input ref={fileRef} type="file" multiple hidden onChange={handlePick} />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger className={PICKER_TRIGGER_CLASS} title={t("添加")}>
          <Plus />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-80" {...closeFocus}>
          <DropdownMenuLabel>{t("添加")}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
            <Paperclip />
            {t("附件")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("技能")}</DropdownMenuLabel>
          {commands.skills.length > 0 ? (
            commands.skills.map((skill) => (
              <DropdownMenuItem key={skill.name} onSelect={() => insertSkill(skill.name)}>
                <Sparkles />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{skill.name}</span>
                  {skill.description ? (
                    <span className="truncate text-xs text-foreground-subtle">
                      {skill.description}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-foreground-subtle">{t("当前目录没有技能")}</p>
          )}
          <DropdownMenuSeparator />
          <p className="px-2 py-1 text-xs text-foreground-subtle">
            {t("@ 添加上下文")} · {t("/ 选择命令或技能")}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
