/** 配置变更后的会话回收计划：活跃的等这一轮落定，空闲的立即回收 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planRecycle } from "../recycle";

describe("planRecycle", () => {
  it("空闲会话立即回收，活跃会话只标脏", () => {
    assert.deepEqual(
      planRecycle([
        { id: "a", active: false },
        { id: "b", active: true },
      ]),
      { dispose: ["a"], markStale: ["b"] },
    );
  });

  it("全部空闲时不需要标脏", () => {
    assert.deepEqual(planRecycle([{ id: "a", active: false }]), { dispose: ["a"], markStale: [] });
  });

  it("没有会话时给出空计划", () => {
    assert.deepEqual(planRecycle([]), { dispose: [], markStale: [] });
  });
});
