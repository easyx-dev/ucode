/**
 * 路径行的右键菜单：复制相对路径 / 复制路径（绝对）。
 *
 * 文件树与 git 变更树共用——两边的路径来源不同（工作目录下的路径 / 仓库相对路径），
 * 但都先归成「绝对路径 + 根」再进来，相对路径统一由 `toRelativePath` 算。
 * 复制失败（非安全上下文且兜底也被拒）才提示；成功也提示一条——右键复制没有视觉落点。
 */
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ContextMenuContent, ContextMenuItem } from "../../base/context-menu";
import { copyText } from "../../lib/clipboard";
import { toRelativePath } from "../../lib/path";

export function PathContextMenu({ path, root }: { path: string; root: string }) {
  const { t } = useTranslation();

  const copy = (text: string): void => {
    void copyText(text).then((ok) => {
      if (ok) toast.success(t("已复制"));
      else toast.error(t("复制失败"));
    });
  };

  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => copy(toRelativePath(root, path))}>
        {t("复制相对路径")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => copy(path)}>{t("复制路径")}</ContextMenuItem>
    </ContextMenuContent>
  );
}
