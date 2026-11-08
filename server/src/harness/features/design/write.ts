/**
 * 改动类设计工具的实作。
 *
 * 一条规矩贯穿全部：**一次调用只做一件事**，改完把结果节点报回去，不回「我改了什么」的清单
 * ——画布会自己刷新，清单只是多一段要读的文字。批量要改很多节点时逐个调用，不要假装一次做完。
 *
 * 写入都走 `hooks.mutate`：改动同步应用、涨 revision、防抖落盘，并把 `design_update` 帧发给画布。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { ImageScaleMode, LayoutMode, SceneGraph, SceneNode } from "@open-pencil/scene-graph";

import { DESIGN_BOARD_GAP, DESIGN_BOARD_SIZE, DESIGN_MAX_NODES } from "../../../constants/design";
import { designError } from "./errors";
import { assertImageBudget, loadDesignImage, pruneUnreferencedImages } from "./images";
import {
  applyPagePosition,
  booleanArg,
  defaultParentOf,
  numberArg,
  pageArg,
  parseColor,
  requiredString,
  stringArg,
  stringArrayArg,
  type ToolArgs,
  targetNode,
  targetRecord,
} from "./mutations";
import {
  describeNode,
  nodeCountOf,
  nodePath,
  pageChildIds,
  renderNodeSvg,
  renderPage,
} from "./query";
import type { DesignToolHooks } from "./types";

export const runWriteTool = async (
  name: string,
  args: ToolArgs,
  hooks: DesignToolHooks,
): Promise<string> => {
  switch (name) {
    case "design_create_shape":
      return createShape(args, hooks);
    case "design_update_node":
      return updateNode(args, hooks);
    case "design_set_fill":
      return setFill(args, hooks);
    case "design_set_image":
      return setImage(args, hooks);
    case "design_set_stroke":
      return setStroke(args, hooks);
    case "design_set_text":
      return setText(args, hooks);
    case "design_set_layout":
      return setLayout(args, hooks);
    case "design_node_resize":
      return resizeNode(args, hooks);
    case "design_node_move":
      return moveNode(args, hooks);
    case "design_delete_node":
      return deleteNode(args, hooks);
    case "design_group_nodes":
      return groupNodes(args, hooks);
    case "design_create_page":
      return createPage(args, hooks);
    case "design_open":
      return openDocument(args, hooks);
    case "design_export_svg":
      return exportSvg(args, hooks);
    default:
      throw designError("invalid_input", `没有这个设计工具：${name}`);
  }
};

/** 改完的确认：一句话 + 该节点当前的完整状态（模型下一步就在这份状态上继续改） */
const confirm = (graph: SceneGraph, action: string, nodeId: string): string =>
  `${action}\n${JSON.stringify(describeNode(graph, nodeId), null, 2)}`;

/** 建节点前的统一检查：每个会新增节点的工具都过这一道，别只在建形状时拦 */
const assertNodeBudget = (graph: SceneGraph): void => {
  if (nodeCountOf(graph) < DESIGN_MAX_NODES) return;
  throw designError(
    "limit_exceeded",
    `文档节点数已达上限（${DESIGN_MAX_NODES}）`,
    "删掉不再需要的节点，或另开一个会话做下一张稿",
  );
};

/**
 * 新画板落在已有画板右侧（同一行）。
 *
 * 一页就是「一屏一行」：不给坐标就让新屏接在右侧，而不是落在页面原点、和第一屏叠在一起
 * （叠上去既不看不见也点不中，只能靠改坐标找回来）。
 */
const nextBoardOrigin = (graph: SceneGraph, pageId: string): { x: number; y: number } => {
  const boards = pageChildIds(graph, pageId)
    .map((id) => graph.getNode(id))
    .filter((node): node is SceneNode => node !== undefined && node.type === "FRAME")
    .map((board) => ({ position: graph.getAbsolutePosition(board.id), width: board.width }));
  const rightmost = boards.reduce<(typeof boards)[number] | undefined>(
    (best, board) =>
      best === undefined || board.position.x + board.width > best.position.x + best.width
        ? board
        : best,
    undefined,
  );
  if (rightmost === undefined) return { x: 0, y: 0 };
  return {
    x: rightmost.position.x + rightmost.width + DESIGN_BOARD_GAP,
    y: rightmost.position.y,
  };
};

const createShape = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const graph = api.graph;
    assertNodeBudget(graph);
    const kind = requiredString(args, "type").toUpperCase();
    const created =
      kind === "FRAME"
        ? api.createFrame()
        : kind === "RECTANGLE"
          ? api.createRectangle()
          : kind === "ELLIPSE"
            ? api.createEllipse()
            : kind === "LINE"
              ? api.createLine()
              : kind === "TEXT"
                ? api.createText()
                : undefined;
    if (created === undefined) {
      throw designError(
        "invalid_input",
        `不支持这种图形：${kind}`,
        "可用 FRAME / RECTANGLE / ELLIPSE / LINE / TEXT",
      );
    }
    // 父节点先解析再改：先建节点再校验 parentId，抛错时它已经挂在页面顶层，成了不会亮起来的孤儿
    const parentId = stringArg(args, "parentId");
    const parent =
      parentId === undefined
        ? defaultParentOf(api, pageArg(graph, args), kind)
        : api.getNodeById(parentId);
    if (parent === null || parent === undefined) {
      created.remove();
      throw designError("not_found", `没有可以放进去的父节点：${parentId ?? ""}`);
    }
    const name = stringArg(args, "name");
    if (name !== undefined) created.name = name;
    // 页面顶层的 Frame 就是一块新画板：一屏的尺寸，不落到通用的 100x100
    const isBoard = kind === "FRAME" && parent.type === "CANVAS";
    created.resize(
      numberArg(args, "width") ?? (isBoard ? DESIGN_BOARD_SIZE.width : 100),
      numberArg(args, "height") ?? (isBoard ? DESIGN_BOARD_SIZE.height : 100),
    );
    const pageX = numberArg(args, "x");
    const pageY = numberArg(args, "y");
    const board =
      isBoard && pageX === undefined && pageY === undefined
        ? nextBoardOrigin(graph, parent.id)
        : undefined;
    if (kind === "TEXT") {
      const text = stringArg(args, "text");
      if (text === undefined) {
        // 没有正文的文本节点画不出任何东西，看起来就像「创建失败」；直接说清楚
        created.remove();
        throw designError("invalid_input", "type 为 TEXT 时必须给 text");
      }
      // 渲染器读的是 characters；裸记录的 text 由它派生，只写 text 会得到一段空绘制
      created.characters = text;
    }
    parent.appendChild(created);
    // 换算在挂上父节点之后：相对坐标要按「最终的父节点」算
    applyPagePosition(graph, created, board?.x ?? pageX, board?.y ?? pageY);
    const path = nodePath(graph, created.id);
    const placed = graph.getAbsolutePosition(created.id);
    const withPosition = board === undefined ? "" : `，排在已有画板右侧（x${placed.x}）`;
    const notice = isBoard
      ? `\n它现在是页面里的一块画板${withPosition}。下一屏再建一块新画板，不要把多屏塞进这一块。`
      : // 平铺的稿子看得对、摸不着：元素落在页面上时移动画板带不动它，提醒一句
        parent.type === "CANVAS"
        ? "\n注意：它建在页面顶层。同一块区域的元素应先建一个容器 Frame 再用 parentId 放进去，层级由嵌套表达。"
        : "";
    return `已创建 ${created.id}：${path}（${created.type} ${created.width}x${created.height}）${notice}`;
  });

const updateNode = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    const name = stringArg(args, "name");
    if (name !== undefined) node.name = name;
    const x = numberArg(args, "x");
    const y = numberArg(args, "y");
    if (x !== undefined || y !== undefined) applyPagePosition(api.graph, node, x, y);
    const width = numberArg(args, "width");
    const height = numberArg(args, "height");
    if (width !== undefined || height !== undefined) {
      node.resize(width ?? node.width, height ?? node.height);
    }
    const opacity = numberArg(args, "opacity");
    if (opacity !== undefined) node.opacity = Math.min(1, Math.max(0, opacity));
    const visible = booleanArg(args, "visible");
    if (visible !== undefined) node.visible = visible;
    const cornerRadius = numberArg(args, "cornerRadius");
    if (cornerRadius !== undefined) node.cornerRadius = cornerRadius;
    return confirm(api.graph, `已更新 ${node.id}`, node.id);
  });

const setFill = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    const color = requiredString(args, "color");
    const parsed = parseColor(color);
    node.fills = [
      {
        type: "SOLID",
        color: { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a },
        opacity: numberArg(args, "opacity") ?? 1,
        visible: true,
      },
    ];
    // 换填充可能让上一张图没人引用：字节留在内存里就还会进文件与每一帧 SVG
    pruneUnreferencedImages(api.graph);
    return confirm(api.graph, `已设置 ${node.id} 的填充`, node.id);
  });

const setImage = async (args: ToolArgs, hooks: DesignToolHooks): Promise<string> => {
  // 先读节点尺寸再压图：存档像素跟显示尺寸走，这一步必须在改动之前落定
  const box = await hooks.read(({ graph }) => {
    const node = targetRecord(graph, hooks.sessionId, args);
    return { width: node.width, height: node.height };
  });
  const image = await loadDesignImage({
    path: requiredString(args, "path"),
    cwd: hooks.cwd,
    box,
  });
  const mode = (stringArg(args, "scaleMode") ?? "FILL") as ImageScaleMode;
  return hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    const graph = api.graph;
    assertImageBudget(graph, image);
    graph.images.set(image.hash, image.bytes);
    node.fills = [
      {
        type: "IMAGE",
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: numberArg(args, "opacity") ?? 1,
        visible: true,
        imageHash: image.hash,
        imageScaleMode: mode,
      },
    ];
    // 换掉旧填充之后可能留下没人引用的字节：不丢就一直进文件与每一帧 SVG
    pruneUnreferencedImages(graph);
    const size = `${image.width}x${image.height}`;
    const compressed = image.resized ? "，已按节点尺寸压过" : "";
    return (
      `${confirm(graph, `已把 ${image.source} 填进 ${node.id}`, node.id)}\n` +
      `图片存档：${size} ${image.mimeType}，${Math.round(image.bytes.byteLength / 1024)}KB${compressed}`
    );
  });
};

const setStroke = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    const parsed = parseColor(requiredString(args, "color"));
    // 描边自带粗细：这次没指定就沿用文档里的值，别把它悄悄改成 1
    const weight = numberArg(args, "weight") ?? node.strokeWeight ?? 1;
    node.strokes = [
      {
        type: "SOLID",
        color: { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a },
        opacity: numberArg(args, "opacity") ?? 1,
        visible: true,
        weight,
        align: "CENTER",
      },
    ];
    return confirm(api.graph, `已设置 ${node.id} 的描边（${weight}px）`, node.id);
  });

const setText = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    if (node.type !== "TEXT") {
      throw designError(
        "invalid_input",
        `节点 ${node.id} 是 ${node.type}，不是文本节点`,
        "design_set_text 只能改 TEXT；改别的节点用 design_update_node",
      );
    }
    const characters = stringArg(args, "characters");
    if (characters !== undefined) node.characters = characters;
    const fontSize = numberArg(args, "fontSize");
    if (fontSize !== undefined) node.fontSize = fontSize;
    const fontFamily = stringArg(args, "fontFamily");
    // 字体族只在裸记录上（代理的排版 setter 收的是解析后的字体对象），改它得写记录本身
    if (fontFamily !== undefined) {
      const raw = api.graph.getNode(node.id);
      if (raw !== undefined) raw.fontFamily = fontFamily;
    }
    const fontWeight = numberArg(args, "fontWeight");
    if (fontWeight !== undefined) node.fontWeight = fontWeight;
    const align = stringArg(args, "textAlignHorizontal");
    if (align !== undefined) node.textAlignHorizontal = align;
    // 代理收的是 Figma 的对象形态；工具收纯像素，模型写的就是像素
    const lineHeight = numberArg(args, "lineHeight");
    if (lineHeight !== undefined) node.lineHeight = { unit: "PIXELS", value: lineHeight };
    const letterSpacing = numberArg(args, "letterSpacing");
    if (letterSpacing !== undefined) node.letterSpacing = { unit: "PIXELS", value: letterSpacing };
    return confirm(api.graph, `已更新 ${node.id} 的文本`, node.id);
  });

const setLayout = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    const mode = stringArg(args, "layoutMode");
    if (mode !== undefined) node.layoutMode = mode as LayoutMode;
    const spacing = numberArg(args, "itemSpacing");
    if (spacing !== undefined) node.itemSpacing = spacing;
    const padding = numberArg(args, "padding");
    if (padding !== undefined) {
      node.paddingTop = padding;
      node.paddingRight = padding;
      node.paddingBottom = padding;
      node.paddingLeft = padding;
    }
    const primary = stringArg(args, "primaryAxisAlign");
    if (primary !== undefined) node.primaryAxisAlignItems = primary;
    const counter = stringArg(args, "counterAxisAlign");
    if (counter !== undefined) node.counterAxisAlignItems = counter;
    return confirm(api.graph, `已设置 ${node.id} 的布局`, node.id);
  });

const resizeNode = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    node.resize(numberArg(args, "width") ?? node.width, numberArg(args, "height") ?? node.height);
    return `已调整 ${node.id} 尺寸：${node.width}x${node.height}`;
  });

const moveNode = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    const current = api.graph.getAbsolutePosition(node.id);
    applyPagePosition(
      api.graph,
      node,
      numberArg(args, "x") ?? current.x,
      numberArg(args, "y") ?? current.y,
    );
    const moved = api.graph.getAbsolutePosition(node.id);
    return `已移动 ${node.id} 到 x${moved.x} y${moved.y}（页面坐标）`;
  });

const deleteNode = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const node = targetNode(api.graph, api, hooks.sessionId, args);
    const label = `${node.id} ${nodePath(api.graph, node.id)}`;
    node.remove();
    return `已删除 ${label}（含它的全部子节点，无法从对话里撤销）`;
  });

const groupNodes = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    if (booleanArg(args, "ungroup") === true) {
      const raw = targetNode(api.graph, api, hooks.sessionId, args);
      const released = api.ungroup(raw);
      return `已解散 ${raw.id}，放出 ${released.length} 个子节点`;
    }
    assertNodeBudget(api.graph);
    const ids = stringArrayArg(args, "ids") ?? [];
    if (ids.length === 0) throw designError("invalid_input", "分组至少要给一个 id");
    const nodes = ids.map((id) => {
      const proxy = api.getNodeById(id);
      if (proxy === null || proxy === undefined) {
        throw designError("not_found", `没有这个节点：${id}`);
      }
      return proxy;
    });
    const first = api.graph.getNode(ids[0] as string);
    const parent = api.getNodeById(first?.parentId ?? pageArg(api.graph, args));
    if (parent === null || parent === undefined) {
      throw designError("invalid_input", "要分的这些节点没有共同的父节点");
    }
    const group = api.group(nodes, parent);
    const name = stringArg(args, "name");
    if (name !== undefined) {
      const raw = api.graph.getNode(group.id);
      if (raw !== undefined) raw.name = name;
    }
    return `已成组 ${group.id}${name === undefined ? "" : `（${name}）`}，含 ${ids.length} 个节点`;
  });

const createPage = (args: ToolArgs, hooks: DesignToolHooks): Promise<string> =>
  hooks.mutate((api) => {
    const graph = api.graph;
    const page = graph.addPage(stringArg(args, "name") ?? `页面 ${graph.getPages().length + 1}`);
    const proxy = api.getNodeById(page.id);
    // 新页成为当前页：用户切回画布时看到的就是它
    if (proxy !== null) api.currentPage = proxy;
    return `已新建页面「${page.name}」（id ${page.id}）。之后的调用带上 pageId: ${page.id}`;
  });

const openDocument = async (args: ToolArgs, hooks: DesignToolHooks): Promise<string> => {
  const path = requiredString(args, "path");
  const { revision, pageId } = await hooks.open(path);
  return (
    `本会话现在在改 ${path}（revision ${revision}${pageId === undefined ? "" : `，当前页 ${pageId}`}）。` +
    "之后的 design_* 调用都落在这份文件上；换一份就再 design_open 一次。"
  );
};

const exportSvg = async (args: ToolArgs, hooks: DesignToolHooks): Promise<string> => {
  const svg = await hooks.read(async ({ graph }) => {
    const pageId = pageArg(graph, args);
    const requested = stringArg(args, "id") ?? stringArg(args, "ref");
    // 没点名就导整页：这是「把稿子拿出来给人看」最常见的用法
    if (requested === undefined) return (await renderPage(graph, pageId, 0)).svg ?? "";
    const { id } = targetRecord(graph, hooks.sessionId, args);
    return (await renderNodeSvg(graph, pageId, id)) ?? "";
  });
  if (svg === "") {
    throw designError("not_found", "没有可导出的内容：页面是空的，或那个节点已经删了");
  }
  const requested = stringArg(args, "path") ?? "design.svg";
  const absolute = isAbsolute(requested) ? requested : resolve(hooks.cwd, requested);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, svg, "utf8");
  return `已导出 ${absolute}（${Buffer.byteLength(svg, "utf8")} 字节）`;
};
