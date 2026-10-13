/**
 * 分栏尺寸的持久化：每个面板用记住的宽度做 `defaultSize`，用户拖完按实测宽度落盘。
 *
 * 不用库的 `defaultLayout`——它只在「键数等于当前面板数」时才生效，而收起某栏后面板数会变，
 * 于是记忆会被静默忽略。按面板各自恢复像素宽度，与「该栏多宽」的直觉一致，也不受收起影响。
 */
import { useCallback, useState } from "react";
import type { GroupProps } from "react-resizable-panels";

import {
  defaultPanelLayout,
  measurePanelWidths,
  type PanelLayout,
  type PanelSpec,
  readPanelLayout,
  writePanelLayout,
} from "../utils/panel-layout";

export function usePanelLayout(
  group: string,
  specs: readonly PanelSpec[],
): {
  /** 取某个面板的初始宽度：上次记住的，没有就用默认值 */
  defaultSizeOf: (spec: PanelSpec) => number;
  onLayoutChanged: NonNullable<GroupProps["onLayoutChanged"]>;
} {
  const [initial] = useState<PanelLayout>(
    () => readPanelLayout(group, specs) ?? defaultPanelLayout(specs),
  );

  const defaultSizeOf = useCallback(
    (spec: PanelSpec) => initial[spec.id] ?? spec.default,
    [initial],
  );

  const onLayoutChanged: NonNullable<GroupProps["onLayoutChanged"]> = useCallback(
    (_layout, meta) => {
      // 只记用户真正拖出来的结果：挂载与约束重算时给出的那份可能还是测量前的中间值
      if (!meta?.isUserInteraction) return;
      writePanelLayout(group, measurePanelWidths(specs));
    },
    [group, specs],
  );

  return { defaultSizeOf, onLayoutChanged };
}
