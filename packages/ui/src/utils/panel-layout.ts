/**
 * 分栏尺寸：栏宽的默认值、持久化与测量。
 *
 * 尺寸一律用**像素**（`react-resizable-panels` 把数字当像素、字符串当百分比）：侧栏就该是 288px，
 * 不随窗口宽度缩放。库的 `defaultLayout` 只在「键数与当前面板数相等」时才生效，而收起某栏时
 * 面板数会变，所以这里不用它——改为每个面板各自用 `defaultSize` 恢复自己记住的宽度，
 * 布局变更时按 DOM 实测像素落盘。占剩余空间的对话区与编辑器区不入库。
 *
 * 外层三栏（会话侧栏 | 对话区 | 工作台）与工作台内部的（文件侧栏 | 编辑器）各是一组，分开记忆。
 */
import { brand } from "@ucode/brand/values";

/** 一个面板的尺寸约束；`id` 同时是布局键与 DOM id */
export type PanelSpec = {
  id: string;
  default: number;
  min: number;
  /** 宽度上限（像素）；缺省即不设上限——能拉多宽由相邻面板的下限决定 */
  max?: number;
};

/** 面板 id：同时充当布局键与 DOM id */
export const PANEL_IDS = {
  sidebar: `${brand.slug}-sidebar`,
  chat: `${brand.slug}-chat`,
  workbench: `${brand.slug}-workbench`,
  workbenchSidebar: `${brand.slug}-workbench-sidebar`,
  workbenchEditor: `${brand.slug}-workbench-editor`,
} as const;

/** 分隔条的 DOM id：便于定位与自动化验证（库本身不要求 id） */
export const HANDLE_IDS = {
  sidebar: `${brand.slug}-sidebar-handle`,
  workbench: `${brand.slug}-workbench-handle`,
  workbenchSidebar: `${brand.slug}-workbench-sidebar-handle`,
} as const;

export const SIDEBAR_PANEL: PanelSpec = { id: PANEL_IDS.sidebar, default: 288, min: 200, max: 400 };

/**
 * 工作台不设宽度上限：屏幕越宽越该能把它拉宽，拉到哪里为止交给对话区的下限。
 * 默认宽度取 VSCode 面板的尺度——里面还要再分「文件侧栏 | 编辑器」，窄了预览区就没法看。
 */
export const WORKBENCH_PANEL: PanelSpec = {
  id: PANEL_IDS.workbench,
  default: 640,
  min: 400,
};

/** 对话区的宽度下限：再窄就读不下正文，拖拽到此为止 */
export const CHAT_MIN_WIDTH = 400;

/** 工作台内部的文件侧栏：默认宽度按「树行 + 头部一行控件」的量给，上限兜住「别把编辑器挤没」 */
export const WORKBENCH_SIDE_PANEL: PanelSpec = {
  id: PANEL_IDS.workbenchSidebar,
  default: 275,
  min: 180,
  max: 360,
};

/** 外层三栏与工作台内部各自的分栏成员 */
export const WORKSPACE_PANELS: readonly PanelSpec[] = [SIDEBAR_PANEL, WORKBENCH_PANEL];

export const WORKBENCH_SIDE_PANELS: readonly PanelSpec[] = [WORKBENCH_SIDE_PANEL];

/** 展开工作台时它能用多少宽度：窗口减去会话侧栏与对话区下限 */
export const workbenchAvailableWidth = (viewportWidth: number, sidebarWidth: number): number =>
  viewportWidth - sidebarWidth - CHAT_MIN_WIDTH;

/** 默认宽度按可用空间夹取：窗口不够宽时退到下限，别把对话区压破 */
export const fitPanelDefault = (spec: PanelSpec, available: number): number =>
  Math.max(spec.min, Math.min(spec.default, available));

/** 一次布局：面板 id → 像素宽；占剩余空间的面板不出现在这里 */
export type PanelLayout = Record<string, number>;

/** 默认尺寸：只为带约束的面板给值，其余交给库分配剩余空间 */
export const defaultPanelLayout = (specs: readonly PanelSpec[]): PanelLayout =>
  Object.fromEntries(specs.map((spec) => [spec.id, spec.default]));

const storageKeyOf = (group: string): string => `${brand.slug}-panels-${group}`;

/** 只保留正有限数，脏数据直接丢 */
const positiveOnly = (value: unknown): PanelLayout => {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, size]) => typeof size === "number" && Number.isFinite(size) && size > 0,
    ),
  ) as PanelLayout;
};

/** 读全部已记住的宽度（含此刻被收起、没在渲染的栏位） */
const readStoredLayout = (group: string): PanelLayout => {
  try {
    const raw = window.localStorage.getItem(storageKeyOf(group));
    return raw === null ? {} : positiveOnly(JSON.parse(raw));
  } catch {
    return {};
  }
};

export const readPanelLayout = (
  group: string,
  specs: readonly PanelSpec[],
): PanelLayout | undefined => {
  const stored = readStoredLayout(group);
  const layout: PanelLayout = {};
  for (const spec of specs) {
    const size = stored[spec.id];
    if (size !== undefined) layout[spec.id] = size;
  }
  return Object.keys(layout).length > 0 ? layout : undefined;
};

/** 按 DOM 实测当前宽度；面板没渲染（该栏收起）时跳过 */
export const measurePanelWidths = (specs: readonly PanelSpec[]): PanelLayout => {
  const widths: PanelLayout = {};
  for (const spec of specs) {
    const element = document.getElementById(spec.id);
    if (element) widths[spec.id] = Math.round(element.getBoundingClientRect().width);
  }
  return widths;
};

/** 落盘：与已记住的合并——此刻收起的栏位没被测量，不能因此丢掉它的宽度 */
export const writePanelLayout = (group: string, layout: PanelLayout): void => {
  try {
    const merged = { ...readStoredLayout(group), ...positiveOnly(layout) };
    window.localStorage.setItem(storageKeyOf(group), JSON.stringify(merged));
  } catch {
    // 写不进去（隐私模式）不影响使用
  }
};
