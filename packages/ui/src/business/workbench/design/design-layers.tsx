/**
 * 图层树：按 `depth` 缩进成树，容器可折叠。放在画布标签里（可隐藏），不再占侧栏。
 *
 * 三件事决定了这里的取法：
 *
 * 1. **折叠是必须的**。一张像样的界面有几十个图层，全展开就把画布挤没了；容器节点给一个折角，
 *    默认展开、收起状态只活在这个组件里（换页、换文件都重建，不值得落盘）。
 * 2. **两个同级按钮**。折角与「选中这一层」是两个动作，一颗按钮里再套一颗是非法 HTML
 *    （见 DESIGN.md「交互嵌套」），所以每行是「折角按钮 + 名称按钮」并排。
 * 3. **层级靠缩进表达**。名字后面的零尺寸标记表示这一层画不出东西（模型常建出 0×0 的占位）。
 */

import type { DesignNodeSummary } from "@ucode/contracts";
import { cn } from "cn";
import {
  ChevronRight,
  EyeOff,
  FileQuestionMark,
  Frame,
  Image as ImageIcon,
  Square,
  Type,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Empty } from "../../../base/empty";
import { ScrollArea } from "../../../base/scroll-area";

/** 节点类型 → 列表图标：只给认得出的几种，其余共用方块 */
const iconOf = (type: string) => {
  if (type === "TEXT") return Type;
  if (type === "FRAME" || type === "COMPONENT" || type === "INSTANCE") return Frame;
  if (type === "ELLIPSE" || type === "IMAGE") return ImageIcon;
  return Square;
};

export function DesignLayers({
  nodes,
  selection,
  onSelect,
  truncated = false,
}: {
  nodes: readonly DesignNodeSummary[];
  selection: readonly string[];
  /** 给了才能点选（不给就只是看） */
  onSelect?: (ids: readonly string[]) => void;
  /** 图层多到一次下发不完：底部说明一句，别让人以为稿子只有这些 */
  truncated?: boolean;
}) {
  const { t } = useTranslation();
  /** 收起的容器 id；默认全展开 */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const parents = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const node of nodes) map.set(node.id, node.parentId);
    return map;
  }, [nodes]);
  const containers = useMemo(() => {
    const set = new Set<string>();
    for (const node of nodes) if (node.parentId !== null) set.add(node.parentId);
    return set;
  }, [nodes]);

  /** 任一层祖先被收起就不显示：扁平列表靠这个模拟折叠 */
  const isHidden = (nodeId: string): boolean => {
    let parent = parents.get(nodeId) ?? null;
    while (parent !== null) {
      if (collapsed.has(parent)) return true;
      parent = parents.get(parent) ?? null;
    }
    return false;
  };

  const toggle = (nodeId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  if (nodes.length === 0) {
    return (
      <Empty
        className="h-full"
        icon={<FileQuestionMark className="size-7" />}
        title={t("还没有图层")}
        hint={t("让 agent 先出稿：设计模式里它用 design_* 工具把界面画出来")}
      />
    );
  }

  const selected = new Set(selection);

  return (
    // 自绘滚动条（`type="always"`）：macOS 的浮层滚动条不动就不显示，浮窗里看不出内容还有多少
    <ScrollArea type="always" horizontal className="min-h-0 flex-1">
      <ul className="py-1" aria-label={t("设计图层")}>
        {nodes
          .filter((node) => !isHidden(node.id))
          .map((node) => {
            const Icon = iconOf(node.type);
            const active = selected.has(node.id);
            const hasChildren = containers.has(node.id);
            const open = hasChildren && !collapsed.has(node.id);
            return (
              <li
                key={node.id}
                className={cn(
                  // 行宽随内容走（长名字横向滚），但不窄于容器：短行的选中 / hover 底色仍铺满整行
                  "flex w-max min-w-full items-stretch",
                  // 高亮铺满整行（直角、左右顶格）：缩进与折角也属于这一行，只亮名字那一段会像没对齐
                  active
                    ? "bg-state-selected"
                    : onSelect === undefined
                      ? undefined
                      : "hover:bg-state-hover",
                )}
              >
                <span style={{ width: `${4 + node.depth * 12}px` }} className="shrink-0" />
                {hasChildren ? (
                  <button
                    type="button"
                    aria-label={open ? t("收起图层") : t("展开图层")}
                    aria-expanded={open}
                    className="flex w-4 shrink-0 items-center justify-center text-foreground-subtlest hover:text-foreground"
                    onClick={() => toggle(node.id)}
                  >
                    <ChevronRight
                      className={cn("size-icon-xs transition-transform", open && "rotate-90")}
                    />
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={onSelect === undefined}
                  onClick={(event) => {
                    if (onSelect === undefined) return;
                    if (event.shiftKey || event.metaKey || event.ctrlKey) {
                      const next = new Set(selected);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      onSelect([...next]);
                      return;
                    }
                    onSelect([node.id]);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left text-xs",
                    active
                      ? "text-foreground"
                      : "text-foreground-subtle enabled:hover:text-foreground",
                  )}
                >
                  <Icon className="size-icon-xs shrink-0" />
                  <span className="whitespace-nowrap">{node.name || t("未命名图层")}</span>
                  {node.width === 0 || node.height === 0 ? (
                    <EyeOff className="ml-auto size-icon-xs shrink-0" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
      </ul>
      {truncated ? (
        <p className="shrink-0 border-t border-border px-2 py-1 text-xs text-foreground-subtle">
          {t("图层太多，这里只列出前 {{count}} 个", { count: nodes.length })}
        </p>
      ) : null}
    </ScrollArea>
  );
}
