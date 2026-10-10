/**
 * 图表预览视口换算的单测：纯函数、无 DOM，覆盖缩放夹取、围绕指针缩放、平移累加与适配窗口的边界。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWheel, clampScale, fitToViewport, panBy, zoomAtPoint } from "../diagram-viewport";

test("缩放夹在 0.25 与 4 之间，非法值退回 1", () => {
  assert.equal(clampScale(0.1), 0.25);
  assert.equal(clampScale(10), 4);
  assert.equal(clampScale(Number.NaN), 1);
});

test("围绕指针缩放时，指针下的内容坐标不动", () => {
  const point = { x: 100, y: 50 };
  const next = zoomAtPoint({ scale: 1, translateX: 0, translateY: 0 }, point, 2);
  assert.equal(next.scale, 2);
  assert.equal(next.translateX + point.x * next.scale, point.x);
  assert.equal(next.translateY + point.y * next.scale, point.y);
});

test("缩放越界时按夹取后的比例摆位", () => {
  const next = zoomAtPoint({ scale: 1, translateX: 0, translateY: 0 }, { x: 10, y: 10 }, 100);
  assert.equal(next.scale, 4);
  assert.equal(next.translateX, 10 - 10 * 4);
});

test("平移只累加位移，不动缩放", () => {
  assert.deepEqual(panBy({ scale: 2, translateX: 10, translateY: -5 }, { x: 3, y: 4 }), {
    scale: 2,
    translateX: 13,
    translateY: -1,
  });
});

test("适配窗口：按较短边缩放并居中，四周留白", () => {
  const next = fitToViewport({
    contentHeight: 100,
    contentWidth: 200,
    viewportHeight: 300,
    viewportWidth: 600,
  });
  // 可用区域 536×236，取较小比例 236/100
  assert.equal(next.scale, 2.36);
  assert.equal(next.translateX, (600 - 200 * 2.36) / 2);
  assert.equal(next.translateY, (300 - 100 * 2.36) / 2);
});

test("内容带偏移时换算到内容坐标系", () => {
  const next = fitToViewport({
    contentHeight: 100,
    contentWidth: 100,
    contentX: 20,
    contentY: 20,
    viewportHeight: 200,
    viewportWidth: 200,
  });
  assert.equal(next.scale, 1.36);
  assert.equal(next.translateX, (200 - 100 * 1.36) / 2 - 20 * 1.36);
});

test("尺寸拿不到时给 1:1，不产生 NaN", () => {
  assert.deepEqual(
    fitToViewport({ contentHeight: 0, contentWidth: 100, viewportHeight: 300, viewportWidth: 300 }),
    { scale: 1, translateX: 0, translateY: 0 },
  );
});

test("滚轮不带修饰键时平移：方向与拖拽一致", () => {
  assert.deepEqual(
    applyWheel({
      deltaX: 10,
      deltaY: 20,
      point: { x: 0, y: 0 },
      transform: { scale: 1, translateX: 0, translateY: 0 },
      zoom: false,
    }),
    { scale: 1, translateX: -10, translateY: -20 },
  );
});

test("Ctrl 加滚轮围绕指针缩放：向上滚放大且指针下的内容不动", () => {
  const point = { x: 50, y: 50 };
  const next = applyWheel({
    deltaX: 0,
    deltaY: -100,
    point,
    transform: { scale: 1, translateX: 0, translateY: 0 },
    zoom: true,
  });
  assert.ok(next.scale > 1);
  assert.equal(next.translateX + point.x * next.scale, point.x);
  assert.equal(next.translateY + point.y * next.scale, point.y);
});
