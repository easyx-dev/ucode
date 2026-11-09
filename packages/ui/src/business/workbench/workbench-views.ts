/**
 * 侧栏各视图的图标与文案：桌面端的竖排活动栏与窄屏的顶部视图条共用一份，两边不会各写一套。
 *
 * 内置视图在这里定死图标与中文名；插件视图带自己的名字与图标名（lucide 名单里的少数几个），
 * 认不出时回落通用图标——「图标名字写错」不该让入口消失。
 */

import type { LucideIcon } from "lucide-react";
import { AppWindow, FolderTree, GitCompare, LayoutTemplate, SquareTerminal } from "lucide-react";

import { pluginIconOf } from "../../utils/plugin-icon";

/** 内置视图的图标；插件视图按名字查 `PLUGIN_VIEW_ICONS` */
const BUILTIN_VIEW_ICON: Record<string, LucideIcon> = {
  changes: GitCompare,
  files: FolderTree,
  terminal: SquareTerminal,
  browser: AppWindow,
};

/** 视图文案：key 即中文原文，查表取值处按需收窄 `t` 的签名 */
const BUILTIN_VIEW_LABEL: Record<string, string> = {
  changes: "源代码管理", // i18n-ignore
  files: "文件浏览", // i18n-ignore
  terminal: "终端", // i18n-ignore
  browser: "浏览器", // i18n-ignore
};

/** 视图的图标：内置查表，插件视图按插件给的图标名查，认不出给通用图标 */
export const viewIconOf = (view: string, pluginIcon?: string): LucideIcon =>
  BUILTIN_VIEW_ICON[view] ?? pluginIconOf(pluginIcon, LayoutTemplate);

/** 视图的文案：插件视图自带展示名（插件负责本地化），内置的走查表 */
export const viewLabelOf = (view: string, pluginLabel?: string): string =>
  BUILTIN_VIEW_LABEL[view] ?? pluginLabel ?? view;
