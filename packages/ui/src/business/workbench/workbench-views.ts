/**
 * 侧栏各视图的图标与文案：桌面端的竖排活动栏与窄屏的顶部视图条共用一份，两边不会各写一套。
 */
import { AppWindow, FolderTree, GitCompare, LayoutTemplate, SquareTerminal } from "lucide-react";

import type { WorkbenchView } from "../../provider/workbench";

export const VIEW_ICON: Record<WorkbenchView, typeof FolderTree> = {
  changes: GitCompare,
  files: FolderTree,
  terminal: SquareTerminal,
  browser: AppWindow,
  design: LayoutTemplate,
};

/** 视图文案：key 即中文原文，查表取值处按需收窄 `t` 的签名 */
export const VIEW_LABEL: Record<WorkbenchView, string> = {
  changes: "源代码管理", // i18n-ignore
  files: "文件浏览", // i18n-ignore
  terminal: "终端", // i18n-ignore
  browser: "浏览器", // i18n-ignore
  design: "设计", // i18n-ignore
};
