/**
 * 项目分组列表：组头可拖拽排序（@dnd-kit），落下后把新次序交给上层写回服务端。
 *
 * 传感器分开配而不是用 PointerSensor：后者要求在拖拽元素上写 `touch-action: none`，
 * 那会连侧栏本身的滚动一起废掉。鼠标走移动阈值（单击仍是展开 / 收起），触屏走长按，
 * 于是触屏上按下就先滚，按住不动才进拖拽。键盘用空格拿起、方向键移动、空格放下。
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { type ReactNode, useMemo } from "react";
import type { SessionSummary } from "../../types";
import type { SessionGroup } from "./session-groups";
import { SessionProjectGroup } from "./session-project-group";

/** 项目区的分组：组一定有目录（助理区不走这个列表） */
export type ProjectGroup = SessionGroup & { path: string };

/** 把分组收窄成有目录的那些；`groupSessions` 的组类型两种分区共用，这里过滤掉助理区 */
export const projectGroupsOf = (groups: readonly SessionGroup[]): ProjectGroup[] =>
  groups.filter((group): group is ProjectGroup => group.path !== null);

type SessionProjectGroupsProps = {
  groups: ProjectGroup[];
  activeId: string | null;
  /** 这一组是否收起 */
  isCollapsed: (path: string) => boolean;
  onCollapsedChange: (path: string, collapsed: boolean) => void;
  onCreate: (path: string) => void;
  onRename: (path: string) => void;
  /** 拖拽落定后的新次序（从上到下） */
  onReorder: (paths: string[]) => void;
  renderItem: (session: SessionSummary) => ReactNode;
};

export function SessionProjectGroups({
  groups,
  activeId,
  isCollapsed,
  onCollapsedChange,
  onCreate,
  onRename,
  onReorder,
  renderItem,
}: SessionProjectGroupsProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const paths = useMemo(() => groups.map((group) => group.path), [groups]);

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    const from = paths.indexOf(String(active.id));
    const to = paths.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(paths, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={paths} strategy={verticalListSortingStrategy}>
        {groups.map((group) => (
          <SessionProjectGroup
            key={group.path}
            name={group.name}
            path={group.path}
            sessions={group.sessions}
            activeId={activeId}
            collapsed={isCollapsed(group.path)}
            onCollapsedChange={(next) => onCollapsedChange(group.path, next)}
            onCreate={() => onCreate(group.path)}
            onRename={() => onRename(group.path)}
            renderItem={renderItem}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
