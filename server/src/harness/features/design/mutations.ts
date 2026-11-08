/**
 * 工具入参的解析与节点定位：所有改动类工具共用这一段。
 *
 * 定位分三种：`ref`（对话里的锚点，权威）、`id`（文档自己的 id）、都没有（只有画布选中集能兜底）。
 * 锚点优先于 id：它是用户亲自点出来的，指向错了就该报错，而不是改一个恰好同 id 的节点。
 */
import type { FigmaAPI, FigmaNodeProxy } from "@open-pencil/core/figma-api";
import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";

import { designError } from "./errors";
import { assertAnchorOwnership } from "./mention";
import { isOnPage, resolvePageId } from "./query";

/** 一次工具调用的原始入参 */
export type ToolArgs = Record<string, unknown>;

export const stringArg = (args: ToolArgs, name: string): string | undefined => {
  const value = args[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw designError("invalid_input", `${name} 应该是字符串`);
  }
  return value;
};

export const requiredString = (args: ToolArgs, name: string): string => {
  const value = stringArg(args, name);
  if (value === undefined) throw designError("invalid_input", `缺少必填参数 ${name}`);
  return value;
};

export const numberArg = (args: ToolArgs, name: string): number | undefined => {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw designError("invalid_input", `${name} 应该是有限数字`);
  }
  return value;
};

export const booleanArg = (args: ToolArgs, name: string): boolean | undefined => {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw designError("invalid_input", `${name} 应该是布尔值`);
  return value;
};

export const stringArrayArg = (args: ToolArgs, name: string): string[] | undefined => {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw designError("invalid_input", `${name} 应该是字符串数组`);
  }
  return value as string[];
};

/** 这一页的 id：给了就必须存在，没给取文档第一页 */
export const pageArg = (graph: SceneGraph, args: ToolArgs): string =>
  resolvePageId(graph, stringArg(args, "pageId"));

/**
 * 引用锚点 → 节点 id：先校验会话归属，再校验节点还在锚点指的那一页上。
 *
 * 页这一段必须核对：节点被挪到别的页之后，锚点仍然是「第 1 页的那个」，照着改会改到用户没指的东西。
 */
const resolveAnchorId = (graph: SceneGraph, ref: string, sessionId: string): string => {
  const anchor = assertAnchorOwnership(ref, sessionId);
  if (!isOnPage(graph, anchor.nodeId, anchor.pageId)) {
    throw designError(
      "anchor_mismatch",
      "这个设计引用指向的节点已经不在那一页了",
      "重新在画布上选中它、再加一次引用，或直接用节点 id",
    );
  }
  return anchor.nodeId;
};

/**
 * 定位要改的节点，返回编辑用的代理。
 *
 * 代理才是可改的对象：裸记录是纯数据，`resize` / `remove` / `appendChild` 这类方法只长在代理上。
 */
export const targetNode = (
  graph: SceneGraph,
  api: FigmaAPI,
  sessionId: string,
  args: ToolArgs,
): FigmaNodeProxy => {
  const ref = stringArg(args, "ref");
  const id = ref === undefined ? stringArg(args, "id") : resolveAnchorId(graph, ref, sessionId);
  if (id === undefined) {
    throw designError(
      "invalid_input",
      "没指定要改哪个节点",
      "用 id / ref 指定，或先用 design_get_tree 或 design_get_selection 拿到 id",
    );
  }
  const raw = graph.getNode(id);
  if (raw === undefined || raw.type === "CANVAS") {
    throw designError(
      "not_found",
      `没有这个节点：${id}`,
      "id 会随删除变化，重新 design_get_tree 取当前的",
    );
  }
  const proxy = api.getNodeById(id);
  if (proxy === null || proxy === undefined) {
    throw designError("invalid_input", `节点 ${id} 不能被编辑`);
  }
  return proxy;
};

/** 定位要读的节点（只读工具用） */
export const targetRecord = (graph: SceneGraph, sessionId: string, args: ToolArgs): SceneNode => {
  const ref = stringArg(args, "ref");
  const id = ref === undefined ? stringArg(args, "id") : resolveAnchorId(graph, ref, sessionId);
  if (id === undefined) {
    throw designError("invalid_input", "没指定要看哪个节点", "用 id / ref 指定");
  }
  const node = graph.getNode(id);
  if (node === undefined || node.type === "CANVAS") {
    throw designError("not_found", `没有这个节点：${id}`);
  }
  return node;
};

/**
 * 父节点原点在页面上的位置。
 *
 * 场景图里的 `node.x/y` 是**相对父节点**的，而工具口径统一是页面坐标（读与写同一套，见 `query.ts`），
 * 所以写入前要做一次换算——否则「读回来是 420、按 420 写回去」会一路往右下漂（叠一次父节点偏移）。
 * 页面本身（`CANVAS`）与文档根的原点就是页面原点。
 */
const parentOffsetOf = (graph: SceneGraph, parentId: string | null): { x: number; y: number } => {
  if (parentId === null) return { x: 0, y: 0 };
  const parent = graph.getNode(parentId);
  if (parent === undefined || parent.type === "CANVAS") return { x: 0, y: 0 };
  return graph.getAbsolutePosition(parentId);
};

/**
 * 把页面坐标写到一个节点上；某一个轴没给就保持它现在的页面位置。
 *
 * 换算基于**父节点当前的原点**，所以「只改 x」不会把节点拽回父节点的顶边。
 */
export const applyPagePosition = (
  graph: SceneGraph,
  node: FigmaNodeProxy,
  pageX: number | undefined,
  pageY: number | undefined,
): void => {
  const offset = parentOffsetOf(graph, graph.getNode(node.id)?.parentId ?? null);
  const current = graph.getAbsolutePosition(node.id);
  node.x = (pageX ?? current.x) - offset.x;
  node.y = (pageY ?? current.y) - offset.y;
};

/**
 * 不给 `parentId` 时新节点落在哪里。
 *
 * 默认是页面顶层——但那会让「画板 + 一堆同级元素」成为最省事的写法：稿子看着对，其实元素并不在画板里，
 * 移动画板、导出画板都带不动它们，图层树也只剩一长条平铺。所以：页面顶层**只有一块** Frame 时，
 * 非 Frame 的图形自动放进那块画板。
 *
 * 两个例外都是刻意的：新建 Frame 一律留在页面顶层（否则再建一块画板会掉进第一块里）；
 * 顶层不止一块 Frame 时不做猜测，仍按页面顶层处理（此时「哪块画板」没有唯一答案）。
 */
export const defaultParentOf = (
  api: FigmaAPI,
  pageId: string,
  kind: string,
): FigmaNodeProxy | null => {
  const page = api.getNodeById(pageId);
  if (page === null || page === undefined || kind === "FRAME") return page ?? null;
  const boards = page.children.filter((child) => child.type === "FRAME");
  return boards.length === 1 ? (boards[0] ?? page) : page;
};

/**
 * 把 CSS 颜色折成 SDK 的 0..1 通道。
 *
 * 只认无歧义的写法：`#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` 与 `rgb()` / `rgba()`。
 * 认不出就报错——猜一个颜色比报错的代价大得多，用户看得出画布上颜色不对，却不知道为什么。
 */
export const parseColor = (value: string): { r: number; g: number; b: number; a: number } => {
  const text = value.trim().toLowerCase();
  const channel = (chunk: string): number =>
    Number.parseInt(chunk.length === 1 ? chunk + chunk : chunk, 16) / 255;
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex !== undefined && [3, 4, 6, 8].includes(hex.length)) {
    const size = hex.length <= 4 ? 1 : 2;
    return {
      r: channel(hex.slice(0, size)),
      g: channel(hex.slice(size, size * 2)),
      b: channel(hex.slice(size * 2, size * 3)),
      a: hex.length === size * 4 ? channel(hex.slice(size * 3, size * 4)) : 1,
    };
  }
  const parts = /^rgba?\(([^)]+)\)$/
    .exec(text)?.[1]
    ?.split(",")
    .map((part) => part.trim());
  if (parts !== undefined && parts.length >= 3) {
    const numeric = (part: string): number => {
      const parsed = Number.parseFloat(part);
      if (!Number.isFinite(parsed)) throw designError("invalid_input", `不是颜色：${value}`);
      return part.endsWith("%") ? parsed / 100 : parsed / 255;
    };
    const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
    return {
      r: numeric(parts[0] as string),
      g: numeric(parts[1] as string),
      b: numeric(parts[2] as string),
      a: Number.isFinite(alpha) ? alpha : 1,
    };
  }
  throw designError(
    "invalid_input",
    `认不出这个颜色：${value}`,
    "用 #RRGGBB、#RGB 或 rgb()/rgba() 写法",
  );
};
