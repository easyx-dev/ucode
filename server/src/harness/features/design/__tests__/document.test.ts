/**
 * 设计文档的单测：种子图、改动的 revision 语义、落盘与重新读回的往返，以及坏文件的留档。
 * 全部跑在临时目录上，不碰 `$APP_HOME`。
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { openDesignDocument } from "../document";
import { pageNodes, renderPage } from "../query";

const dirs: string[] = [];

const tempPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "design-doc-"));
  dirs.push(dir);
  return join(dir, "doc.json");
};

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("设计文档", () => {
  it("新文档带一页与一块空白画板，但只看一眼不落文件", async () => {
    const path = tempPath();
    const document = await openDesignDocument(path);
    const pages = document.graph.getPages();
    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.name, "页面 1");
    const rows = pageNodes(document.graph, pages[0]?.id ?? "").rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, "画板");
    // 读过不等于写过：打开画布、读摘要都不该在用户仓库里建文件
    await document.close();
    assert.equal(existsSync(path), false);
  });

  it("meta 写进文件：只有标题与 createdAt（不含任何会话信息），createdAt 只记第一次", async () => {
    const path = tempPath();
    const document = await openDesignDocument(path, {
      writeDebounceMs: 60_000,
      meta: { title: "音乐 App 首页" },
    });
    await document.mutate((api) => api.createRectangle());
    await document.flush();
    const first = JSON.parse(readFileSync(path, "utf8")) as {
      meta: Record<string, unknown>;
    };
    assert.equal(first.meta.sessionId, undefined);
    assert.equal(first.meta.title, "音乐 App 首页");
    const createdAt = first.meta.createdAt;

    await document.mutate((api) => api.createRectangle());
    await document.flush();
    const second = JSON.parse(readFileSync(path, "utf8")) as { meta: { createdAt: string } };
    // 每次写都刷新归档时间，会让文件在 git 里每存一次就变一次
    assert.equal(second.meta.createdAt, createdAt);
    await document.close();
  });

  it("首次改动才把文件建出来", async () => {
    const path = tempPath();
    const document = await openDesignDocument(path, { writeDebounceMs: 60_000 });
    await document.mutate((api) => api.createRectangle());
    await document.flush();
    assert.match(readFileSync(path, "utf8"), /"format":1/);
    await document.close();
  });

  it("改动涨 revision 并落盘，重新打开还能读回来", async () => {
    const path = tempPath();
    const document = await openDesignDocument(path);
    const before = document.revision();
    const pageId = document.graph.getPages()[0]?.id ?? "";
    const created = await document.mutate((api) => {
      const text = api.createText();
      text.name = "标题";
      text.characters = "音乐";
      text.fontSize = 24;
      return text.id;
    });
    assert.equal(document.revision(), before + 1);
    // 落盘是防抖的：重新打开前先把这一批改动推下去
    await document.flush();

    const reopened = await openDesignDocument(path);
    const rows = pageNodes(reopened.graph, pageId).rows;
    const restored = rows.find((row) => row.id === created);
    assert.equal(restored?.name, "标题");
    assert.equal(restored?.type, "TEXT");
    assert.equal(reopened.revision(), 0);

    await document.close();
    await reopened.close();
  });

  it("防抖：连续改动只写一次，flush 后文件与内存一致", async () => {
    const path = tempPath();
    const document = await openDesignDocument(path, { writeDebounceMs: 60_000 });
    await document.mutate((api) => {
      const box = api.createRectangle();
      box.name = "卡片";
    });
    // 防抖还没到，改动只在内存里
    assert.equal(existsSync(path), false);
    await document.flush();
    assert.match(readFileSync(path, "utf8"), /卡片/);
    await document.close();
  });

  it("reset 换成一张空白文档并涨 revision", async () => {
    const path = tempPath();
    const document = await openDesignDocument(path);
    await document.mutate((api) => api.createRectangle());
    const before = document.revision();
    await document.reset();
    assert.equal(document.revision(), before + 1);
    const pageId = document.graph.getPages()[0]?.id ?? "";
    assert.deepEqual(
      pageNodes(document.graph, pageId).rows.map((row) => row.name),
      ["画板"],
    );
    await document.close();
  });

  it("读不懂的文件被留档，不静默当成空文档", async () => {
    const path = tempPath();
    writeFileSync(path, "{ this is not json", "utf8");
    const document = await openDesignDocument(path);
    assert.match(document.warning() ?? "", /已留档为/);
    // 坏文件还在目录里，只是换了名字
    const aside = readdirSync(join(path, "..")).filter((name) => name.includes(".corrupt-"));
    assert.equal(aside.length, 1);
    // 坏文件留了档，但也没有顺手写一份新的：等真正改动再建
    assert.equal(existsSync(path), false);
    await document.close();
  });
});

describe("整页 drawing", () => {
  it("画面与命中框出自同一版，坐标是页面空间", async () => {
    const path = tempPath();
    const document = await openDesignDocument(path);
    const pageId = document.graph.getPages()[0]?.id ?? "";
    await document.mutate((api) => {
      const frame = api.createFrame();
      frame.name = "手机屏";
      frame.resize(200, 100);
      frame.x = 40;
      frame.y = 20;
      return frame.id;
    });
    const render = await renderPage(document.graph, pageId, document.revision());
    assert.equal(render.revision, document.revision());
    assert.ok((render.svg ?? "").length > 0);
    // 外接矩形量的是直属子节点的并集：种子画板（0,0 375x812）与这块 200x100 的并集仍是前者
    assert.deepEqual(render.bounds, { x: 0, y: 0, width: 375, height: 812 });
    const boxes = Object.values(render.boxes);
    assert.ok(
      boxes.some((box) => box.x === 40 && box.y === 20 && box.width === 200),
      "页面里的那块画板要在命中框里",
    );
    await document.close();
  });
});
