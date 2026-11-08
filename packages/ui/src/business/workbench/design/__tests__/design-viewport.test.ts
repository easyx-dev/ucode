/** 画布取景的纯逻辑：包络、适应视图、档位与比例文案 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampScale,
  DESIGN_MAX_SCALE,
  DESIGN_MIN_SCALE,
  designExtent,
  fitScale,
  fitView,
  formatScale,
  nodesInMarquee,
  normalizeMarquee,
  panView,
  stepScale,
  zoomViewAt,
} from "../design-viewport";

describe("画布取景", () => {
  it("包络取所有节点盒子的并集", () => {
    const extent = designExtent(
      {
        a: { x: 100, y: 50, width: 200, height: 100 },
        b: { x: 120, y: 200, width: 40, height: 40 },
      },
      null,
    );
    assert.deepEqual(extent, { minX: 100, minY: 50, width: 200, height: 190 });
  });

  it("没有盒子时退回渲染给的外接矩形", () => {
    assert.deepEqual(designExtent({}, { x: 0, y: 0, width: 375, height: 812 }), {
      minX: 0,
      minY: 0,
      width: 375,
      height: 812,
    });
    assert.equal(designExtent({}, null), null);
  });

  it("适应视图只缩小不放大", () => {
    const small = fitScale(
      { minX: 0, minY: 0, width: 100, height: 100 },
      {
        width: 800,
        height: 600,
      },
    );
    assert.equal(small, 1);
    const large = fitScale(
      { minX: 0, minY: 0, width: 1600, height: 300 },
      {
        width: 800,
        height: 600,
      },
    );
    // 可用宽度 800-64=736，1600 宽要缩到 0.46
    assert.equal(large, 0.46);
  });

  it("没有内容或还没量到可视区时回落 1", () => {
    assert.equal(fitScale(null, { width: 800, height: 600 }), 1);
    assert.equal(
      fitScale({ minX: 0, minY: 0, width: 100, height: 100 }, { width: 0, height: 0 }),
      1,
    );
  });

  it("缩放落在上下限内", () => {
    assert.equal(clampScale(0.01), DESIGN_MIN_SCALE);
    assert.equal(clampScale(99), DESIGN_MAX_SCALE);
  });

  it("档位缩放取相邻一档，单次变化不超过三成，到头停住", () => {
    assert.equal(stepScale(1, 1), 1.25);
    assert.equal(stepScale(1, -1), 0.75);
    assert.equal(stepScale(0.5, 1), 0.67);
    assert.equal(stepScale(4, 1), DESIGN_MAX_SCALE);
    assert.equal(stepScale(0.1, -1), DESIGN_MIN_SCALE);
    // 连续往大走十次，每次的变化都不该超过三成
    let scale = 0.5;
    for (let index = 0; index < 10; index += 1) {
      const next = stepScale(scale, 1);
      assert.ok(next / scale <= 1.35, `${scale} → ${next} 跳得太大`);
      scale = next;
    }
  });

  it("平移：屏幕像素直接叠加，可以拖到任意远处", () => {
    assert.deepEqual(panView({ scale: 1, x: 10, y: 20 }, -300, 400), {
      scale: 1,
      x: -290,
      y: 420,
    });
  });

  it("绕光标缩放：光标下的画稿内容不动", () => {
    const view = { scale: 1, x: 100, y: 50 };
    const cursor = { x: 200, y: 150 };
    const zoomed = zoomViewAt(view, cursor, 2);
    assert.equal(zoomed.scale, 2);
    // 光标处对应的页面坐标（相对视口）= (200-100)/1 = 100；放大后仍应在同一屏幕位置
    const before = (cursor.x - view.x) / view.scale;
    const after = (cursor.x - zoomed.x) / zoomed.scale;
    assert.ok(Math.abs(before - after) < 1e-9);
  });

  it("缩放到上限时不再位移", () => {
    const view = { scale: DESIGN_MAX_SCALE, x: 0, y: 0 };
    assert.deepEqual(zoomViewAt(view, { x: 10, y: 10 }, DESIGN_MAX_SCALE * 2), view);
  });

  it("适应视图把内容居中", () => {
    const view = fitView(
      { minX: 0, minY: 0, width: 375, height: 812 },
      {
        width: 800,
        height: 600,
      },
    );
    // 600-64=536 是可用高，812 装不下 → 536/812
    assert.ok(Math.abs(view.scale - 536 / 812) < 1e-9);
    assert.ok(view.x > 0);
    assert.equal(view.y, 32);
    assert.deepEqual(fitView(null, { width: 800, height: 600 }), { scale: 1, x: 0, y: 0 });
  });

  it("框选：两个角点任意方向都归一成左上加重尺寸", () => {
    assert.deepEqual(normalizeMarquee({ x: 10, y: 10 }, { x: 30, y: 40 }), {
      x: 10,
      y: 10,
      width: 20,
      height: 30,
    });
    assert.deepEqual(normalizeMarquee({ x: 30, y: 40 }, { x: 10, y: 10 }), {
      x: 10,
      y: 10,
      width: 20,
      height: 30,
    });
  });

  it("框选命中取「相交」而不是「完全包含」", () => {
    const boxes = {
      // 大画板：画框只压在它上面一小块，也算选中
      board: { x: 0, y: 0, width: 375, height: 812 },
      // 完全在框里
      inside: { x: 20, y: 20, width: 50, height: 50 },
      // 框外
      outside: { x: 500, y: 500, width: 40, height: 40 },
      // 压住框的右下角一角：相交
      overlap: { x: 110, y: 100, width: 40, height: 40 },
      // 正好贴着框的右边线（x=120）：只相切，不算相交
      touching: { x: 120, y: 0, width: 20, height: 20 },
    };
    assert.deepEqual(nodesInMarquee(boxes, { x: 10, y: 10, width: 110, height: 100 }).sort(), [
      "board",
      "inside",
      "overlap",
    ]);
    assert.deepEqual(nodesInMarquee(boxes, { x: 600, y: 600, width: 10, height: 10 }), []);
  });

  it("比例文案整百不带小数", () => {
    assert.equal(formatScale(1), "100%");
    assert.equal(formatScale(0.75), "75%");
    assert.equal(formatScale(1.333), "133.3%");
  });
});
