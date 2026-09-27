import { describe, expect, it } from "vitest";
import {
  buildGoalPrompt,
  createGoalState,
  DEFAULT_MAX_CONTINUATIONS,
  GOAL_CUSTOM_TYPE,
  parseGoalState,
  restoreGoal,
} from "./state.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("目标状态", () => {
  it("创建时默认 active、续跑 0、有默认额度", () => {
    const goal = createGoalState("把 README 写完", NOW);
    expect(goal.status).toBe("active");
    expect(goal.continuations).toBe(0);
    expect(goal.maxContinuations).toBe(DEFAULT_MAX_CONTINUATIONS);
    expect(goal.createdAt).toBe(NOW.toISOString());
  });

  it("可自定义额度上限", () => {
    expect(createGoalState("x", NOW, 3).maxContinuations).toBe(3);
  });
});

describe("目标恢复", () => {
  const entry = (data: unknown, customType = GOAL_CUSTOM_TYPE) => ({
    type: "custom",
    customType,
    data,
  });

  it("取最后一条 goal 记录", () => {
    const first = createGoalState("旧目标", NOW);
    const second = { ...createGoalState("新目标", NOW), status: "paused" as const };
    expect(restoreGoal([entry(first), { type: "message" }, entry(second)])?.objective).toBe(
      "新目标",
    );
    expect(restoreGoal([entry(first), entry(second)])?.status).toBe("paused");
  });

  it("clear（data 为 null）终止回溯，而不是回到更早的目标", () => {
    const old = createGoalState("旧目标", NOW);
    expect(restoreGoal([entry(old), entry(null)])).toBeNull();
  });

  it("没有 goal 记录时为 null", () => {
    expect(restoreGoal([{ type: "custom", customType: "other", data: {} }])).toBeNull();
  });

  it("损坏的 data 被忽略", () => {
    expect(parseGoalState({ status: "bogus" })).toBeNull();
    expect(parseGoalState("nope")).toBeNull();
  });
});

describe("目标提示", () => {
  it("包含目标、剩余额度与完成指引", () => {
    const goal = { ...createGoalState("写测试", NOW, 5), continuations: 2 };
    const prompt = buildGoalPrompt(goal);
    expect(prompt).toContain("写测试");
    expect(prompt).toContain("剩余自动续跑额度：3");
    expect(prompt).toContain("action=complete");
  });

  it("非 active 时明确提示不要自行推进", () => {
    const goal = { ...createGoalState("x", NOW), status: "paused" as const };
    expect(buildGoalPrompt(goal)).toContain("不要自行推进");
  });
});
