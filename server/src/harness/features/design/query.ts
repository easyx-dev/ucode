/**
 * 文档的只读投影：页面表、扁平节点摘要、整页 drawing。
 *
 * 这里全是纯读，不改文档也不涨 revision，所以路由与工具都能随手调。
 *
 * **坐标是页面空间**（页面左上为原点，x 向右 y 向下，单位像素）。SDK 渲染出的 SVG 也按页面坐标定位，
 * 于是 drawing 与命中框天然对齐，画布上点一下不需要再做换算。
 */

import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";
import type {
  DesignBox,
  DesignNodeDetail,
  DesignNodeSummary,
  DesignPage,
  DesignPaint,
  DesignRender,
} from "@ucode/contracts";

import { designError } from "./errors";
import { loadDesignSdk } from "./sdk";

/** 文档的页面表，按文档顺序 */
export const listPages = (graph: SceneGraph): DesignPage[] =>
  graph.getPages().map((page) => ({ id: page.id, name: page.name }));

/** 一页在不在文档里（`CANVAS` 就是页） */
export const isPage = (graph: SceneGraph, pageId: string): boolean =>
  graph.getNode(pageId)?.type === "CANVAS";

/**
 * 解析这一页：调用方给了就必须存在，没给就取文档第一页。
 *
 * 画布只会问它被下发过的页，工具只会问它读到过的页——所以「页不存在」是调用方的错，要报出来。
 */
export const resolvePageId = (graph: SceneGraph, pageId?: string): string => {
  if (pageId !== undefined && pageId !== "") {
    if (!isPage(graph, pageId)) {
      throw designError("not_found", `没有这一页：${pageId}`, "用 design_get_tree 取当前页与节点");
    }
    return pageId;
  }
  const first = listPages(graph)[0];
  if (first === undefined) {
    throw designError(
      "not_found",
      "文档里还没有页面",
      "调用它会自动建一页；这一步不该发生，请重建文档",
    );
  }
  return first.id;
};

/** 页面的直属子节点 id（整页 drawing 画的就是它们） */
export const pageChildIds = (graph: SceneGraph, pageId: string): string[] => [
  ...(graph.getNode(pageId)?.childIds ?? []),
];

/**
 * 把一页摊平成节点摘要行，父在前、子在后的深度优先序。
 *
 * `maxDepth` 只收浅层（模型常常只关心顶层结构）；`limit` 兜住输出体积。
 */
export const pageNodes = (
  graph: SceneGraph,
  pageId: string,
  options: { maxDepth?: number; limit?: number } = {},
): { rows: DesignNodeSummary[]; truncated: boolean } => {
  const rows: DesignNodeSummary[] = [];
  let truncated = false;
  const walk = (parentId: string, depth: number): void => {
    const parent = graph.getNode(parentId);
    if (parent === undefined) return;
    if (options.maxDepth !== undefined && depth > options.maxDepth) return;
    for (const childId of parent.childIds) {
      if (options.limit !== undefined && rows.length >= options.limit) {
        truncated = true;
        return;
      }
      const child = graph.getNode(childId);
      if (child === undefined) continue;
      rows.push(summarise(graph, child, depth));
      walk(childId, depth + 1);
    }
  };
  walk(pageId, 0);
  return { rows, truncated };
};

/** 一行摘要：模型要照着改，画布要拿它做命中框 */
export const summarise = (graph: SceneGraph, node: SceneNode, depth: number): DesignNodeSummary => {
  const position = graph.getAbsolutePosition(node.id);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: position.x,
    y: position.y,
    width: node.width,
    height: node.height,
    parentId: node.parentId,
    depth,
  };
};

/** `nodeId` 是否在这一页下面（锚点里的页就是为这个校验准备的） */
export const isOnPage = (graph: SceneGraph, nodeId: string, pageId: string): boolean => {
  let current = graph.getNode(nodeId);
  while (current !== undefined) {
    if (current.id === pageId) return true;
    if (current.parentId === null) return false;
    current = graph.getNode(current.parentId);
  }
  return false;
};

/** 文档里所有节点（含页、含文档根）的数量，用于上限判定 */
export const nodeCountOf = (graph: SceneGraph): number => graph.nodes.size;

/**
 * 整页 drawing。
 *
 * drawing 与命中框出自同一次遍历：拆成两条路径会拿到新图配旧几何，点选就落到隔壁节点上。
 * 空的直属子节点给空串（画布据此显示空态），内容边界给 null（没有可适应的东西）。
 */
export const renderPage = async (
  graph: SceneGraph,
  pageId: string,
  revision: number,
): Promise<DesignRender> => {
  const sdk = await loadDesignSdk();
  const children = pageChildIds(graph, pageId);
  const svg = sdk.renderNodesToSvg(graph, pageId, children) ?? "";
  const boxes: Record<string, DesignBox> = Object.fromEntries(
    pageNodes(graph, pageId).rows.map((row) => [
      row.id,
      { x: row.x, y: row.y, width: row.width, height: row.height },
    ]),
  );
  // 外接矩形量的是直属子节点：它们的并集就是整幅画，量摊平后的全部节点会把已含在父框里的子节点算两遍
  const measured = children.length === 0 ? null : sdk.computeContentBounds(graph, children);
  return {
    revision,
    pageId,
    svg,
    boxes,
    bounds:
      measured === null
        ? null
        : {
            x: measured.minX,
            y: measured.minY,
            width: measured.maxX - measured.minX,
            height: measured.maxY - measured.minY,
          },
  };
};

/** 单个节点的 SVG（缩略图、复制用）；节点不存在返回 undefined */
export const renderNodeSvg = async (
  graph: SceneGraph,
  pageId: string,
  nodeId: string,
): Promise<string | undefined> => {
  const sdk = await loadDesignSdk();
  return sdk.renderNodesToSvg(graph, pageId, [nodeId]) ?? undefined;
};

/** 节点的显示路径，如 `手机屏 / 头部 / 标题`；界面的芯片上用它认节点 */
export const nodePath = (graph: SceneGraph, nodeId: string): string => {
  const segments: string[] = [];
  let current = graph.getNode(nodeId);
  while (current !== undefined && current.type !== "CANVAS") {
    segments.unshift(current.name);
    current = current.parentId === null ? undefined : graph.getNode(current.parentId);
  }
  return segments.join(" / ");
};

/**
 * 节点详情：模型改之前要看到的那一份。
 *
 * 文本类字段读的是裸记录（`characters` 的 setter 写的就是裸记录的 `text`，读代理拿不到原值）。
 */
export const describeNode = (graph: SceneGraph, nodeId: string): DesignNodeDetail => {
  const node = graph.getNode(nodeId);
  if (node === undefined) throw designError("not_found", `没有这个节点：${nodeId}`);
  const position = graph.getAbsolutePosition(nodeId);
  const detail: DesignNodeDetail = {
    id: node.id,
    name: node.name,
    type: node.type,
    path: nodePath(graph, nodeId),
    x: position.x,
    y: position.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    cornerRadius: node.cornerRadius,
    fills: node.fills.map(paintOf),
    strokes: node.strokes.map((stroke) => ({ ...paintOf(stroke), weight: stroke.weight })),
    strokeWeight: node.strokeWeight,
    layoutMode: node.layoutMode,
    itemSpacing: node.itemSpacing,
    padding: {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft,
    },
    childCount: node.childIds.length,
  };
  if (node.type !== "TEXT") return detail;
  return {
    ...detail,
    text: {
      characters: node.text,
      fontSize: node.fontSize,
      fontFamily: node.fontFamily,
      fontWeight: node.fontWeight,
      textAlignHorizontal: node.textAlignHorizontal,
      lineHeight: node.lineHeight,
      letterSpacing: node.letterSpacing,
    },
  };
};

/** 一笔填充 / 描边摊平成契约形状（颜色通道原样：0..1） */
const paintOf = (paint: {
  type: string;
  color: { r: number; g: number; b: number; a: number };
  opacity: number;
  visible: boolean;
  imageHash?: string;
  imageScaleMode?: string;
}): DesignPaint => ({
  type: paint.type,
  color: { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: paint.color.a },
  opacity: paint.opacity,
  visible: paint.visible,
  ...(paint.imageHash === undefined ? {} : { imageHash: paint.imageHash }),
  ...(paint.imageScaleMode === undefined ? {} : { imageScaleMode: paint.imageScaleMode }),
});
