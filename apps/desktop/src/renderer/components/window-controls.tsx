/**
 * 自绘窗口控件：三颗点（关 / 最小化 / 全屏），替掉无标题栏窗口里被隐藏的系统红绿灯。
 *
 * 绿点按 macOS 惯例是「全屏」，符号随状态换（全屏时是朝里的那对箭头）；⌥ 点击是同一颗钮的 macOS 变体
 * ——最大化 / 还原（`zoom`，AppKit 里这颗钮本来就叫 zoom button）。全屏期间不接 ⌥：全屏窗口不可缩放。
 * 拖拽区双击同样能最大化（系统的标题栏行为），但那是系统那套，不由这颗点承担。
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
import { type LucideIcon, Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { WindowControlAction, WindowState } from "../../shared/window-controls";
import { titleBarInset, windowControlsWidth } from "../lib/window-chrome";

/** 三颗点的标识：既是底色取法，也是不按修饰键时的动作 */
type ControlDotId = "close" | "minimize" | "fullscreen";

const TONE: Record<ControlDotId, string> = {
  close: "bg-window-control-close",
  minimize: "bg-window-control-minimize",
  fullscreen: "bg-window-control-zoom",
};

function ControlDot({
  action,
  altAction,
  icon: Icon,
  label,
}: {
  action: ControlDotId;
  /** 按住 ⌥ 点击时改送的动作；不传就与 `action` 相同 */
  altAction?: WindowControlAction;
  /** 悬停时露出的符号 */
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`group flex size-window-control items-center justify-center rounded-full ${TONE[action]}`}
      onClick={(event) =>
        window.desktop.windowControl(event.altKey ? (altAction ?? action) : action)
      }
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
  /** 窗口态：失焦时整组置灰（系统交通灯也这样）、全屏时绿点换成朝里的箭头；默认聚焦且未全屏，首帧由主进程纠正 */
  const [state, setState] = useState<WindowState>({ focused: true, fullscreen: false });

  useEffect(() => window.desktop.onWindowState(setState), []);

  const { focused, fullscreen } = state;

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
      <ControlDot action="close" icon={X} label={t("关闭窗口")} />
      <ControlDot action="minimize" icon={Minus} label={t("最小化窗口")} />
      <ControlDot
        action="fullscreen"
        altAction={fullscreen ? undefined : "zoom"}
        icon={fullscreen ? Minimize2 : Maximize2}
        label={fullscreen ? t("退出全屏") : t("进入全屏")}
      />
    </div>
  );
}
