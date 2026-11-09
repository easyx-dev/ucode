/**
 * 插件点名的图标：插件在清单里写一个 lucide 名（`boxes` / `layout-template` 这类），
 * 宿主按白名单换成组件。认不出时给兜底图标——「图标名字写错」不该让入口消失，
 * 也不该为了「任意图标」把整包 lucide 打进产物。
 */

import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  Boxes,
  Compass,
  FolderTree,
  GitCompare,
  LayoutTemplate,
  Palette,
  SquareTerminal,
} from "lucide-react";

/** 白名单：视图与模式共用一份，新增名字只改这里 */
const PLUGIN_ICONS: Record<string, LucideIcon> = {
  "layout-template": LayoutTemplate,
  "square-terminal": SquareTerminal,
  "folder-tree": FolderTree,
  "git-compare": GitCompare,
  "app-window": AppWindow,
  boxes: Boxes,
  palette: Palette,
};

export const pluginIconOf = (
  name: string | undefined,
  fallback: LucideIcon = Compass,
): LucideIcon => (name && PLUGIN_ICONS[name]) || fallback;
