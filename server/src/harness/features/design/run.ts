/**
 * 只读类设计工具的实作，以及工具名到实作的分发。
 *
 * 输出面向模型：树是**带缩进的行**而不是 JSON（同一份信息，行文省一大截 token，模型也更好按行读），
 * 单节点详情才是 JSON（改的时候要精确字段）。坐标一律报页面空间，与 `design_get_tree` 的口径一致——
 * 模型照着数字改，才不会每次都偏一个父节点的偏移。
 */

import type { SceneGraph } from "@open-pencil/scene-graph";
import type { DesignNodeSummary } from "@ucode/contracts";

import { DESIGN_FIND_LIMIT, DESIGN_TREE_ROW_LIMIT } from "../../../constants/design";
import { designError } from "./errors";
import { numberArg, pageArg, stringArg, type ToolArgs, targetRecord } from "./mutations";
import { describeNode, listPages, nodePath, pageNodes } from "./query";
import type { DesignToolHooks } from "./types";
import { runWriteTool } from "./write";

/** 改动文档的工具名：其余都是只读的 */
const WRITE_TOOL_NAMES = new Set<string>([
  "design_create_shape",
  "design_update_node",
  "design_set_fill",
  "design_set_stroke",
  "design_set_text",
  "design_set_layout",
  "design_node_resize",
  "design_node_move",
  "design_delete_node",
  "design_group_nodes",
  "design_create_page",
  "design_open",
  "design_export_svg",
]);

export const isWriteToolName = (name: string): boolean => WRITE_TOOL_NAMES.has(name);

/** 跑一个工具，返回模型看到的那段文本 */
export const runDesignTool = async (
  name: string,
  args: ToolArgs,
  hooks: DesignToolHooks,
): Promise<string> =>
  isWriteToolName(name) ? runWriteTool(name, args, hooks) : runReadTool(name, args, hooks);

const runReadTool = async (
  name: string,
  args: ToolArgs,
  hooks: DesignToolHooks,
): Promise<string> => {
  switch (name) {
    case "design_get_tree":
      return hooks.read(({ graph, path, warning }) => treeText(graph, args, path, warning));
    case "design_get_node":
      return hooks.read(({ graph }) => {
        const node = targetRecord(graph, hooks.sessionId, args);
        return JSON.stringify(describeNode(graph, node.id), null, 2);
      });
    case "design_find_nodes":
      return hooks.read(({ graph }) => findText(graph, args));
    case "design_get_selection":
      return hooks.read(
        ({ graph, path }) => `文件：${path}\n${selectionText(graph, hooks.selection())}`,
      );
    default:
      throw designError("invalid_input", `没有这个设计工具：${name}`);
  }
};

const round = (value: number): number => Math.round(value * 100) / 100;

/** 文本节点的正文摘要：树上直接看得见写的是什么，省一次 design_get_node */
const textPreviewOf = (graph: SceneGraph, nodeId: string): string => {
  const node = graph.getNode(nodeId);
  if (node?.type !== "TEXT" || node.text === "") return "";
  const text = node.text.replaceAll("\n", " ");
  return ` “${text.length > 24 ? `${text.slice(0, 24)}…` : text}”`;
};

const rowLine = (graph: SceneGraph, row: DesignNodeSummary): string =>
  `${"  ".repeat(row.depth)}- ${row.id} ${row.name} [${row.type}] ` +
  `x${round(row.x)} y${round(row.y)} ${round(row.width)}x${round(row.height)}` +
  textPreviewOf(graph, row.id);

const treeText = (graph: SceneGraph, args: ToolArgs, path: string, warning?: string): string => {
  const pageId = pageArg(graph, args);
  const page = graph.getNode(pageId);
  const { rows, truncated } = pageNodes(graph, pageId, {
    maxDepth: numberArg(args, "maxDepth"),
    limit: DESIGN_TREE_ROW_LIMIT,
  });
  const pages = listPages(graph)
    .map((entry) => `${entry.name}（${entry.id}）`)
    .join("、");
  return [
    `文件：${path}`,
    `页：${page?.name ?? ""}（id ${pageId}），文档共 ${listPages(graph).length} 页：${pages}`,
    `节点 ${rows.length} 个${truncated ? `（已截断到 ${DESIGN_TREE_ROW_LIMIT} 行，用 design_find_nodes 按名字或类型找）` : ""}：`,
    ...rows.map((row) => rowLine(graph, row)),
    "坐标是页面空间：页面左上为原点，x 向右、y 向下，单位像素。",
    ...(warning === undefined ? [] : [`注意：${warning}`]),
  ].join("\n");
};

const findText = (graph: SceneGraph, args: ToolArgs): string => {
  const pageId = pageArg(graph, args);
  const query = stringArg(args, "query")?.toLowerCase();
  const type = stringArg(args, "type")?.toUpperCase();
  if (query === undefined && type === undefined) {
    throw designError(
      "invalid_input",
      "find 至少要给 query 或 type",
      "不知道要找什么就用 design_get_tree",
    );
  }
  // 先全页匹配再截断：把扫描上限当结果上限，节点多起来就会在「第 51 行之后」误报没有匹配
  const matches = pageNodes(graph, pageId)
    .rows.filter((row) => query === undefined || row.name.toLowerCase().includes(query))
    .filter((row) => type === undefined || row.type === type);
  const kept = matches.slice(0, DESIGN_FIND_LIMIT);
  return [
    `匹配 ${matches.length}${matches.length > DESIGN_FIND_LIMIT ? `（只列前 ${DESIGN_FIND_LIMIT} 个）` : ""}：`,
    ...kept.map((row) => rowLine(graph, row)),
    ...(kept.length === 0 ? ["没有匹配的节点：换个关键字，或先用 design_get_tree 看全貌。"] : []),
  ].join("\n");
};

const selectionText = (graph: SceneGraph, ids: readonly string[]): string => {
  if (ids.length === 0) {
    return "画布里现在没有选中任何节点。要按名字找，用 design_find_nodes；要看全貌，用 design_get_tree。";
  }
  return [
    `画布选中 ${ids.length} 个节点（按选中顺序）：`,
    ...ids.map((id) => {
      const node = graph.getNode(id);
      if (node === undefined) return `- ${id}（已被删除）`;
      const position = graph.getAbsolutePosition(id);
      return (
        `- ${id} ${nodePath(graph, id)} [${node.type}] ` +
        `x${round(position.x)} y${round(position.y)} ${round(node.width)}x${round(node.height)}`
      );
    }),
  ].join("\n");
};
