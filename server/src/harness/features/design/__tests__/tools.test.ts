/**
 * 设计工具的单测：读写都走真实文档，只把落盘目录换到临时目录。
 *
 * 覆盖四类容易出错的语义：建文本必须给正文、只读工具不涨 revision、锚点跨会话被拒、
 * 目标已删时按「没有这个节点」报错（而不是改到别人身上）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { DESIGN_BOARD_GAP } from "../../../../constants/design";
import type { DesignDocument } from "../document";
import { openDesignDocument } from "../document";
import { isDesignError } from "../errors";
import { formatAnchor, mentionPrefixOf } from "../mention";
import { DESIGN_PARAMETERS } from "../parameters";
import { pageNodes } from "../query";
import { isWriteToolName, runDesignTool } from "../run";
import { DESIGN_TOOL_NAMES } from "../tools";
import type { DesignToolHooks } from "../types";

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const setup = async (): Promise<{ document: DesignDocument; hooks: DesignToolHooks }> => {
  const dir = mkdtempSync(join(tmpdir(), "design-tools-"));
  dirs.push(dir);
  const document = await openDesignDocument(join(dir, "doc.json"), { writeDebounceMs: 60_000 });
  const selection: string[] = [];
  const hooks: DesignToolHooks = {
    sessionId: "s-1",
    cwd: dir,
    read: async (operation) =>
      operation({
        graph: document.graph,
        revision: document.revision(),
        path: document.path,
        ...(document.warning() === undefined ? {} : { warning: document.warning() }),
      }),
    mutate: (operation) => document.mutate(operation),
    selection: () => selection,
    // 这份夹具固定在一份文档上；换文档（design_open）由 service 的单测覆盖
    open: async () => {
      throw new Error("这份夹具不支持换文档");
    },
  };
  return { document, hooks };
};

const pageIdOf = (document: DesignDocument): string => document.graph.getPages()[0]?.id ?? "";

describe("工具清单", () => {
  it("每个工具名都有入参 schema，写工具也都认得", () => {
    for (const name of DESIGN_TOOL_NAMES) {
      assert.ok(DESIGN_PARAMETERS[name], `${name} 缺少入参 schema`);
      assert.equal(
        isWriteToolName(name),
        !name.startsWith("design_get") && name !== "design_find_nodes",
      );
    }
  });
});

describe("设计工具", () => {
  it("建文本节点必须给正文，否则拒掉而不是留一个看不见的空节点", async () => {
    const { document, hooks } = await setup();
    const before = document.graph.nodes.size;
    await assert.rejects(
      () => runDesignTool("design_create_shape", { type: "TEXT", name: "空标题" }, hooks),
      (error: unknown) => isDesignError(error) && error.code === "invalid_input",
    );
    assert.equal(document.graph.nodes.size, before);
    await document.close();
  });

  it("建、改、读三步串起来，坐标是页面空间", async () => {
    const { document, hooks } = await setup();
    const created = await runDesignTool(
      "design_create_shape",
      { type: "RECTANGLE", name: "卡片", x: 24, y: 120, width: 200, height: 80 },
      hooks,
    );
    assert.match(created, /卡片/);
    const id = created.match(/已创建 (\S+)：/)?.[1];
    assert.ok(id);

    await runDesignTool("design_set_fill", { id, color: "#4F46E5" }, hooks);
    const detail = JSON.parse(await runDesignTool("design_get_node", { id }, hooks)) as {
      fills: { color: { r: number; b: number } }[];
      x: number;
      y: number;
    };
    assert.equal(detail.x, 24);
    assert.equal(detail.y, 120);
    // #4F46E5 → r=79/255、b=229/255
    assert.equal(Math.round((detail.fills[0]?.color.r ?? 0) * 255), 79);
    assert.equal(Math.round((detail.fills[0]?.color.b ?? 0) * 255), 229);
    await document.close();
  });

  it("嵌套节点也用页面坐标：写进去的就是读回来的那个值", async () => {
    const { document, hooks } = await setup();
    const frame = await runDesignTool(
      "design_create_shape",
      { type: "FRAME", name: "屏", x: 100, y: 100, width: 375, height: 812 },
      hooks,
    );
    const frameId = frame.match(/已创建 (\S+)：/)?.[1] ?? "";
    const rect = await runDesignTool(
      "design_create_shape",
      {
        type: "RECTANGLE",
        name: "卡片",
        x: 120,
        y: 130,
        width: 100,
        height: 50,
        parentId: frameId,
      },
      hooks,
    );
    const rectId = rect.match(/已创建 (\S+)：/)?.[1] ?? "";
    const positionOf = async (): Promise<{ x: number; y: number }> =>
      JSON.parse(await runDesignTool("design_get_node", { id: rectId }, hooks)) as {
        x: number;
        y: number;
      };

    // 读的是页面坐标（父节点在 100,100）：写进去的 120,130 就是读回来的 120,130
    const created = await positionOf();
    assert.deepEqual([created.x, created.y], [120, 130]);

    // 移动与改写也是页面坐标：把读到的坐标原样写回去不会一路往右下漂
    await runDesignTool("design_node_move", { id: rectId, x: 140, y: 150 }, hooks);
    const moved = await positionOf();
    assert.deepEqual([moved.x, moved.y], [140, 150]);
    await runDesignTool("design_update_node", { id: rectId, x: 160, y: 170 }, hooks);
    const updated = await positionOf();
    assert.deepEqual([updated.x, updated.y], [160, 170]);

    // 只给一个轴时另一个轴不动（换算错的话会被拽回父节点顶边）
    await runDesignTool("design_update_node", { id: rectId, x: 180 }, hooks);
    const onlyX = await positionOf();
    assert.deepEqual([onlyX.x, onlyX.y], [180, 170]);
    await document.close();
  });

  it("新画板不给坐标就排在已有画板右侧，默认一屏尺寸", async () => {
    const { document, hooks } = await setup();
    const pageId = pageIdOf(document);
    const first = pageNodes(document.graph, pageId).rows.find((row) => row.type === "FRAME");
    assert.ok(first);

    const second = await runDesignTool(
      "design_create_shape",
      { type: "FRAME", name: "第二屏" },
      hooks,
    );
    const secondId = second.match(/已创建 (\S+)：/)?.[1] ?? "";
    const board = document.graph.getNode(secondId);
    // 画板在页面顶层：叠进第一块里，屏就不再是独立的一屏
    assert.equal(board?.parentId, pageId);
    assert.equal(board?.x, first.x + first.width + DESIGN_BOARD_GAP);
    assert.equal(board?.y, first.y);
    assert.equal(board?.width, 375);
    assert.equal(board?.height, 812);

    const third = await runDesignTool(
      "design_create_shape",
      { type: "FRAME", name: "第三屏" },
      hooks,
    );
    const thirdId = third.match(/已创建 (\S+)：/)?.[1] ?? "";
    assert.equal(document.graph.getNode(thirdId)?.x, (board?.x ?? 0) + 375 + DESIGN_BOARD_GAP);
    await document.close();
  });

  it("只读工具不涨 revision", async () => {
    const { document, hooks } = await setup();
    const before = document.revision();
    await runDesignTool("design_get_tree", {}, hooks);
    await runDesignTool("design_get_selection", {}, hooks);
    assert.equal(document.revision(), before);
    await document.close();
  });

  it("本会话的锚点直接改到那颗节点，跨会话的锚点被拒", async () => {
    const { document, hooks } = await setup();
    const created = await runDesignTool(
      "design_create_shape",
      { type: "FRAME", name: "屏" },
      hooks,
    );
    const id = created.match(/已创建 (\S+)：/)?.[1] ?? "";
    const pageId = pageIdOf(document);

    const anchor = formatAnchor(mentionPrefixOf("s-1"), pageId, id);
    const updated = await runDesignTool("design_node_move", { ref: anchor, x: 10, y: 20 }, hooks);
    assert.match(updated, /x10 y20/);

    const foreign = formatAnchor(mentionPrefixOf("s-2"), pageId, id);
    await assert.rejects(
      () => runDesignTool("design_node_move", { ref: foreign, x: 0, y: 0 }, hooks),
      (error: unknown) => isDesignError(error) && error.code === "anchor_mismatch",
    );
    await document.close();
  });

  it("目标节点已删时报「没有这个节点」，不改到别的节点上", async () => {
    const { document, hooks } = await setup();
    const created = await runDesignTool(
      "design_create_shape",
      { type: "ELLIPSE", name: "圈" },
      hooks,
    );
    const id = created.match(/已创建 (\S+)：/)?.[1] ?? "";
    await runDesignTool("design_delete_node", { id }, hooks);
    await assert.rejects(
      () => runDesignTool("design_set_fill", { id, color: "#000000" }, hooks),
      (error: unknown) => isDesignError(error) && error.code === "not_found",
    );
    await document.close();
  });

  it("不给 parentId 时元素落进唯一的画板，新建 Frame 则留在页面顶层", async () => {
    const { document, hooks } = await setup();
    const pageId = pageIdOf(document);
    const boardId = pageNodes(document.graph, pageId).rows.find((row) => row.type === "FRAME")?.id;
    assert.ok(boardId);

    const text = await runDesignTool(
      "design_create_shape",
      { type: "TEXT", name: "问候", text: "晚上好" },
      hooks,
    );
    const textId = text.match(/已创建 (\S+)：/)?.[1] ?? "";
    // 平铺的稿子「看着对、摸不着」：移动画板带不动它，图层树也只剩一长条
    assert.equal(document.graph.getNode(textId)?.parentId, boardId);
    assert.match(text, /画板 \/ 问候/);

    const frame = await runDesignTool(
      "design_create_shape",
      { type: "FRAME", name: "状态栏" },
      hooks,
    );
    const frameId = frame.match(/已创建 (\S+)：/)?.[1] ?? "";
    // 新建 Frame 不自动嵌套，否则再建一块画板会掉进第一块里
    assert.equal(document.graph.getNode(frameId)?.parentId, pageId);

    // 显式 parentId 仍然照办：放进新 Frame 里，图层树多一层
    const nested = await runDesignTool(
      "design_create_shape",
      { type: "TEXT", name: "时间", text: "9:41", parentId: frameId },
      hooks,
    );
    assert.match(nested, /状态栏 \/ 时间/);
    await document.close();
  });

  it("新建页面：返回新页 id，后续改动可以落在它上面", async () => {
    const { document, hooks } = await setup();
    const created = await runDesignTool("design_create_page", { name: "详情页" }, hooks);
    const pageId = created.match(/id (\S+)）/)?.[1];
    assert.ok(pageId, created);
    assert.equal(document.graph.getPages().length, 2);

    const shape = await runDesignTool(
      "design_create_shape",
      { type: "RECTANGLE", name: "卡片", pageId },
      hooks,
    );
    const shapeId = shape.match(/已创建 (\S+)：/)?.[1] ?? "";
    const rows = pageNodes(document.graph, pageId).rows;
    assert.ok(
      rows.some((row) => row.id === shapeId),
      "新建的图形要落在新页上",
    );
    // 老页面不受影响
    assert.equal(pageNodes(document.graph, pageIdOf(document)).rows.length, 1);
    await document.close();
  });

  it("导出 SVG 写到会话工作目录", async () => {
    const { document, hooks } = await setup();
    const result = await runDesignTool("design_export_svg", { path: "out/board.svg" }, hooks);
    assert.match(result, /已导出/);
    assert.match(readFileSync(join(hooks.cwd, "out/board.svg"), "utf8"), /<svg/);
    await document.close();
  });
});
