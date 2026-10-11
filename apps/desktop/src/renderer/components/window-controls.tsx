/**
 * 自绘窗口控件：三颗点（关 / 最小化 / 缩放），替掉无标题栏窗口里被隐藏的系统红绿灯。
 *
 * 位置由我们定——固定在左端（`left: 0` + 左侧内边距，宽度占 `WINDOW_CONTROLS_WIDTH`）、
 * 中线读布局实测的 `--window-controls-center`，展开 / 收起侧栏都不移动。
 * 交互按 macOS 交通灯的惯例：悬停显示操作符号、窗口失焦时整组置灰。
 *
 * 它在 DOM 里是「宿主拖拽区」的后代（展开时宿主是侧栏顶部那条、收起时是对话区头部），
 * 由布局决定挂在哪——`-webkit-app-region` 的 `no-drag` 只对**同一子树**生效，
 * 挂成兄弟子树的话这几颗点会被覆盖它的拖拽区吃掉点击（表现为「点不动，只会拖窗口」）。
 *
 * 层级与可交互性由控件自己带（`z-chrome` + `pointer-events-auto`）：宿主条只在工作区里铺，而全屏面板
 * （设置 / 使用统计，`z-50`）打开时会盖住整块工作区，还会给 `body` 设 `pointer-events: none`——
 * 控件是窗口镶边，得既浮在遮罩之上、又拿得到点击，否则窗口关不掉。
 * （宿主条本身不抬层级：它包含头部的按钮，抬上来会让那些按钮穿透面板可点。）
 */
import { Maximize2, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WindowControlAction } from "../../shared/window-controls";
import { titleBarInset, windowControlsWidth } from "../lib/window-chrome";

const TONE = {
  close: "bg-window-control-close",
  minimize: "bg-window-control-minimize",
  zoom: "bg-window-control-zoom",
} as const;

const ICON = { close: X, minimize: Minus, zoom: Maximize2 } as const;

function ControlDot({ action, label }: { action: WindowControlAction; label: string }) {
  const Icon = ICON[action];

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`group flex size-window-control items-center justify-center rounded-full ${TONE[action]}`}
      onClick={() => window.desktop.windowControl(action)}
    >
      {/* 符号平时不显示：悬停这一组时才露出来，静止时就是一排纯色点（macOS 的做法） */}
      <Icon
        className="size-2 text-window-control-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-60"
        strokeWidth={3}
      />
    </button>
  );
}

export function WindowControls() {
  const { t } = useTranslation();
  /** 窗口是否聚焦：失焦时整组置灰（系统交通灯也这样）；默认聚焦，首帧由主进程纠正 */
  const [focused, setFocused] = useState(true);

  useEffect(() => window.desktop.onWindowFocus(setFocused), []);

  return (
    <div
      // 纵向位置只由 paddingTop 决定：这里不能用 items-center（那会再居中一次，把点再往下推）；
      // 层级与可交互性都由它自己带（见文件头）：弹层会给 `body` 设 pointer-events: none，
      // 光靠 z 只会「看得见、点不动」，得把这一块的事件收回来
      className={`pointer-events-auto fixed top-0 left-0 z-chrome flex items-start gap-2 pl-5 ${focused ? "" : "opacity-40"}`}
      data-window-controls
      style={{
        width: windowControlsWidth(),
        height: titleBarInset(),
        // 点自身固定 14px：让点的中线落在布局报出来的中线上；
        // 没报到时（服务不可用态没有工作区可量）落在顶部让位区的中间，而不是贴在窗口边上
        paddingTop: `calc(var(--window-controls-center, ${titleBarInset() / 2}px) - var(--spacing-window-control) / 2)`,
      }}
    >
      <ControlDot action="close" label={t("关闭窗口")} />
      <ControlDot action="minimize" label={t("最小化窗口")} />
      <ControlDot action="zoom" label={t("缩放窗口")} />
    </div>
  );
}
