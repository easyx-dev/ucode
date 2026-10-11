import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONTEXT_BUDGET_MAX_TOKENS } from "../../../constants/session";
import { contextBudgetOf } from "../budget";

describe("上下文预算", () => {
  it("大窗口被绝对上限收住，触发点不再跟着窗口水涨船高", () => {
    const budget = contextBudgetOf({ contextWindow: 1_048_576 });
    assert.equal(budget.triggerTokens, CONTEXT_BUDGET_MAX_TOKENS);
    assert.equal(budget.reserveTokens, 1_048_576 - CONTEXT_BUDGET_MAX_TOKENS);
  });

  it("中小窗口维持「窗口 − 留白」的原判据", () => {
    assert.equal(contextBudgetOf({ contextWindow: 32_768 }).triggerTokens, 16_384);
    assert.equal(contextBudgetOf({ contextWindow: 131_072 }).triggerTokens, 114_688);
    assert.equal(contextBudgetOf({ contextWindow: 204_800 }).triggerTokens, 184_320);
  });

  it("保留量随窗口缩放并夹在上下限内", () => {
    assert.equal(contextBudgetOf({ contextWindow: 32_768 }).keepRecentTokens, 4_915);
    assert.equal(contextBudgetOf({ contextWindow: 204_800 }).keepRecentTokens, 30_720);
    assert.equal(contextBudgetOf({ contextWindow: 1_048_576 }).keepRecentTokens, 40_000);
  });

  it("配置覆盖优先，但仍不许越过窗口与上限", () => {
    assert.equal(
      contextBudgetOf({ contextWindow: 1_048_576, override: 300_000 }).triggerTokens,
      300_000,
    );
    assert.equal(
      contextBudgetOf({ contextWindow: 1_048_576, override: 900_000 }).triggerTokens,
      CONTEXT_BUDGET_MAX_TOKENS,
    );
    assert.equal(
      contextBudgetOf({ contextWindow: 131_072, override: 999_999 }).triggerTokens,
      114_688,
    );
  });

  it("窗口极小时留白不吞掉半个窗口，保留量始终小于触发点", () => {
    const budget = contextBudgetOf({ contextWindow: 8_192 });
    assert.ok(budget.reserveTokens > 0);
    assert.ok(budget.triggerTokens < 8_192);
    assert.ok(budget.keepRecentTokens < budget.triggerTokens);
  });
});
