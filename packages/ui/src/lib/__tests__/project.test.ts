/** 项目在界面侧的取值单测：展示名回落目录末段，初始设置缺项显式给 undefined */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectLabel, projectOf, projectSeedOf } from "../project";
import type { ProjectSummary } from "../types";

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: "p1",
  path: "/work/a",
  name: null,
  model: null,
  thinkingLevel: null,
  mode: null,
  permissionMode: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("projectOf", () => {
  it("按路径取行，没有对应行或没有路径时给 null", () => {
    const projects = [project(), project({ id: "p2", path: "/work/b" })];
    assert.equal(projectOf(projects, "/work/b")?.id, "p2");
    assert.equal(projectOf(projects, "/work/none"), null);
    assert.equal(projectOf(projects, null), null);
    assert.equal(projectOf(projects, undefined), null);
  });
});

describe("projectLabel", () => {
  it("项目名优先，未命名时用目录末段", () => {
    assert.equal(projectLabel("/work/a", project({ name: "甲" })), "甲");
    assert.equal(projectLabel("/work/a/", project()), "a");
    assert.equal(projectLabel("/work/a", null), "a");
  });
});

describe("projectSeedOf", () => {
  it("把项目记住的四项摊成草稿初始设置", () => {
    assert.deepEqual(
      projectSeedOf(
        project({ model: "p/m", thinkingLevel: "low", mode: "plan", permissionMode: "auto" }),
      ),
      { model: "p/m", thinkingLevel: "low", mode: "plan", permissionMode: "auto" },
    );
  });

  it("没有项目或项目未记住时，四项都显式给 undefined（切换目录要清掉旧值）", () => {
    const empty = {
      model: undefined,
      thinkingLevel: undefined,
      mode: undefined,
      permissionMode: undefined,
    };
    assert.deepEqual(projectSeedOf(null), empty);
    assert.deepEqual(projectSeedOf(project()), empty);
  });
});
