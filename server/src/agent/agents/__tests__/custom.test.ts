/**
 * 自定义子角色单测：发现、解析、覆盖内置与坏文件跳过。
 *
 * 角色文件是用户可写的运行时数据，这里重点守住「坏文件不污染其余角色」与
 * 「自定义角色只作子角色、不能占主模式名」两条边界。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  allSubagents,
  effectiveToolNames,
  loadAgentRegistry,
  parseCustomAgent,
  primaryCapability,
  resolveSubagentCapability,
  subagentProfile,
} from "../index";

const makeRegistry = (files: Record<string, string>) => {
  const agentDir = mkdtempSync(join(tmpdir(), "custom-agent-test-"));
  if (Object.keys(files).length > 0) {
    const dir = join(agentDir, "agents");
    mkdirSync(dir);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  }
  return loadAgentRegistry(agentDir);
};

const valid = (over: { frontmatter?: string; body?: string } = {}): string =>
  [
    "---",
    'description: "评审改动，给出风险清单"',
    ...(over.frontmatter ? [over.frontmatter] : []),
    "---",
    over.body ?? "你是代码评审子智能体，只做评审。",
  ].join("\n");

describe("loadAgentRegistry", () => {
  it("没有 agents 目录时只有内置角色", () => {
    const registry = makeRegistry({});
    assert.deepEqual(Object.keys(registry.subagents).sort(), ["explore", "general"]);
    assert.deepEqual(registry.errors, []);
  });

  it("解析合法角色：展示名、工具白名单、模型与正文", () => {
    const registry = makeRegistry({
      "reviewer.md": valid({
        frontmatter: 'name: "代码评审"\ntools: read, grep',
        body: "你是评审角色。",
      }),
    });
    assert.deepEqual(registry.errors, []);
    const profile = subagentProfile("reviewer", registry);
    assert.equal(profile.kind, "subagent");
    assert.equal(profile.label, "代码评审");
    assert.equal(profile.description, "评审改动，给出风险清单");
    assert.equal(profile.promptSection, "你是评审角色。");
    assert.deepEqual(profile.capability.toolSelection, {
      kind: "allowlist",
      tools: ["read", "grep"],
    });
  });

  it("tools 缺省或 inherit 时继承父能力", () => {
    for (const frontmatter of [undefined, "tools: inherit"]) {
      const registry = makeRegistry({ "worker.md": valid({ frontmatter }) });
      const profile = subagentProfile("worker", registry);
      assert.equal(profile.capability.toolSelection.kind, "inherit");
      const capability = resolveSubagentCapability(profile, primaryCapability("build"));
      assert.ok(effectiveToolNames(capability).includes("edit"), "继承应保留写盘能力");
    }
  });

  it("与内置子角色同名时覆盖", () => {
    const registry = makeRegistry({
      "general.md": valid({ frontmatter: 'name: "自定义通用"', body: "自定义通用正文。" }),
    });
    const profile = subagentProfile("general", registry);
    assert.equal(profile.label, "自定义通用");
    assert.equal(profile.promptSection, "自定义通用正文。");
  });

  it("advertise: false 的角色仍进全量清单（可调用，只是不广告）", () => {
    const registry = makeRegistry({
      "hidden.md": valid({ frontmatter: "advertise: false" }),
    });
    assert.ok(allSubagents(registry).some((profile) => profile.slug === "hidden"));
    assert.equal(subagentProfile("hidden", registry).advertise, false);
  });

  it("坏文件只跳过自己并记下原因，其余角色照常加载", () => {
    const registry = makeRegistry({
      "good.md": valid(),
      "BadName.md": valid(),
      "build.md": valid(),
      "nodefault.md": ["---", "---", "正文"].join("\n"),
      "notools.md": valid({ frontmatter: "tools: read, nope" }),
      "empty.md": ["---", 'description: "x"', "---"].join("\n"),
    });
    assert.ok(subagentProfile("good", registry).slug === "good");
    const files = registry.errors.map((entry) => entry.file).sort();
    assert.deepEqual(files, ["BadName.md", "build.md", "empty.md", "nodefault.md", "notools.md"]);
    assert.ok(!("build" in registry.subagents), "主模式名不能被自定义角色占用");
  });

  it("未带注册表时未知角色仍按内置集合报错", () => {
    assert.throws(() => subagentProfile("reviewer"));
  });
});

describe("parseCustomAgent", () => {
  it("frontmatter 缺 description 时报错", () => {
    assert.throws(() => parseCustomAgent("x", ["---", "name: x", "---", "正文"].join("\n")));
  });

  it("未知 frontmatter 键报错并给出中文原因，避免拼写错误静默放宽 tools", () => {
    assert.throws(
      () => parseCustomAgent("x", valid({ frontmatter: "tool: read" })),
      /未知字段：tool/,
    );
  });

  it("frontmatter 起始标记未闭合时给出准确原因，而不是推到 description 上", () => {
    assert.throws(
      () => parseCustomAgent("x", ["---", "name: x", "正文"].join("\n")),
      /缺少对应的结束/,
    );
  });

  it("字段类型错误使用中文文案", () => {
    assert.throws(
      () => parseCustomAgent("x", valid({ frontmatter: "name: 123" })),
      /name 必须是字符串/,
    );
  });

  it("tools 列表去重", () => {
    const profile = parseCustomAgent("x", valid({ frontmatter: "tools: read, grep, read" }));
    assert.deepEqual(profile.capability.toolSelection, {
      kind: "allowlist",
      tools: ["read", "grep"],
    });
  });
});
