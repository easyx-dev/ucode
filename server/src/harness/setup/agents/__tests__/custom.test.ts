/**
 * 自定义角色单测：发现、解析、覆盖内置与坏文件跳过。
 *
 * 角色文件是用户可写的运行时数据，这里重点守住「坏文件不污染其余角色」、
 * 「primary 可覆盖内置三模式」与「纯 subagent 不占主模式名」几条边界。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { AGENTS_DIRNAME } from "../../../../constants/dirs";
import {
  allSubagents,
  effectiveToolNames,
  hasPrimaryMode,
  loadAgentRegistry,
  parseCustomAgent,
  primaryCapability,
  primaryProfile,
  resolveSubagentCapability,
  subagentProfile,
} from "..";

const makeRegistry = (files: Record<string, string>) => {
  const appHome = mkdtempSync(join(tmpdir(), "custom-agent-test-"));
  if (Object.keys(files).length > 0) {
    const dir = join(appHome, AGENTS_DIRNAME);
    mkdirSync(dir);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  }
  return loadAgentRegistry({ cwd: appHome, appHome });
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
    assert.deepEqual(registry.primary, {});
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

  it("mode: primary 覆盖内置 build，并可用新 slug", () => {
    const registry = makeRegistry({
      "build.md": valid({
        frontmatter: 'mode: primary\nname: "自定义编码"',
        body: "自定义 build 正文。",
      }),
      "writer.md": valid({ frontmatter: "mode: primary", body: "写作正文。" }),
    });
    assert.deepEqual(registry.errors, []);

    const build = primaryProfile("build", registry);
    assert.equal(build.label, "自定义编码");
    assert.equal(build.source, "global");
    assert.equal(build.promptSection, "自定义 build 正文。");

    assert.ok(hasPrimaryMode("writer", registry));
    const writer = primaryProfile("writer", registry);
    assert.equal(writer.kind, "primary");
    assert.equal(writer.capability.toolSelection.kind, "defaultTools");
  });

  it("mode: all 同时进 primary 与 subagent", () => {
    const registry = makeRegistry({ "both.md": valid({ frontmatter: "mode: all" }) });
    assert.ok(hasPrimaryMode("both", registry));
    assert.equal(primaryProfile("both", registry).kind, "primary");
    assert.equal(subagentProfile("both", registry).kind, "subagent");
  });

  it("纯 subagent 仍拒绝与主模式同名", () => {
    const registry = makeRegistry({ "plan.md": valid() });
    assert.ok(!hasPrimaryMode("plan", registry) || registry.subagents.plan === undefined);
    assert.ok(registry.errors.some((error) => error.file === "plan.md"));
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
      "nodefault.md": ["---", "---", "正文"].join("\n"),
      "notools.md": valid({ frontmatter: "tools: read, nope" }),
      "empty.md": ["---", 'description: "x"', "---"].join("\n"),
    });
    assert.ok(subagentProfile("good", registry).slug === "good");
    const files = registry.errors.map((entry) => entry.file).sort();
    assert.deepEqual(files, ["BadName.md", "empty.md", "nodefault.md", "notools.md"]);
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

  it("mode 缺省为 subagent，显式 primary 时 kind 也随之", () => {
    assert.equal(parseCustomAgent("x", valid()).mode, "subagent");
    assert.equal(parseCustomAgent("x", valid()).profile.kind, "subagent");
    const primary = parseCustomAgent("x", valid({ frontmatter: "mode: primary" }));
    assert.equal(primary.mode, "primary");
    assert.equal(primary.profile.kind, "primary");
  });

  it("primary 不允许 tools: inherit", () => {
    assert.throws(
      () => parseCustomAgent("x", valid({ frontmatter: "mode: primary\ntools: inherit" })),
      /不支持 tools: inherit/,
    );
  });

  it("tools 列表去重", () => {
    const { profile } = parseCustomAgent("x", valid({ frontmatter: "tools: read, grep, read" }));
    assert.deepEqual(profile.capability.toolSelection, {
      kind: "allowlist",
      tools: ["read", "grep"],
    });
  });
});

describe("插件角色", () => {
  const pluginAgent = (
    over: Partial<{
      slug: string;
      tools: string[];
      disallowedTools: string[];
      model: string;
    }> = {},
  ) => ({
    kind: "subagent" as const,
    slug: over.slug ?? "my-plugin-reviewer",
    label: "Reviewer",
    description: "审查改动",
    promptSection: "正文",
    tools: over.tools ?? [],
    disallowedTools: over.disallowedTools ?? [],
    ...(over.model ? { model: over.model } : {}),
  });

  it("落成子角色并标来源 plugin，主模式不受影响", () => {
    const registry = loadAgentRegistry({
      cwd: "/tmp",
      appHome: "/tmp",
      pluginAgents: [pluginAgent()],
    });

    const placed = registry.subagents["my-plugin-reviewer"];
    assert.equal(placed?.kind, "subagent");
    assert.equal(placed?.source, "plugin");
    assert.equal(placed?.promptSection, "正文");
    assert.deepEqual(placed?.capability.toolSelection, { kind: "inherit" });
    assert.deepEqual(registry.primary, {}, "插件角色不做主模式");
    assert.deepEqual(registry.errors, []);
  });

  it("工具档位：白名单优先，只给黑名单时按已知工具减去它", () => {
    const allow = loadAgentRegistry({
      cwd: "/tmp",
      appHome: "/tmp",
      pluginAgents: [pluginAgent({ tools: ["read", "grep", "not-a-tool"] })],
    });
    assert.deepEqual(allow.subagents["my-plugin-reviewer"]?.capability.toolSelection, {
      kind: "allowlist",
      tools: ["read", "grep"],
    });

    const deny = loadAgentRegistry({
      cwd: "/tmp",
      appHome: "/tmp",
      pluginAgents: [pluginAgent({ disallowedTools: ["bash", "edit"] })],
    });
    const selection = deny.subagents["my-plugin-reviewer"]?.capability.toolSelection;
    assert.equal(selection?.kind, "allowlist");
    const tools = selection?.kind === "allowlist" ? selection.tools : [];
    assert.ok(tools.length > 0);
    assert.ok(!tools.includes("bash"));
    assert.ok(!tools.includes("edit"));
    assert.ok(tools.includes("read"));
    // 执行类工具按能力组成组：插件只写 bash 时，Windows 上的 powershell 也必须一并拿掉，
    // 否则「不要执行命令」的收窄在那边漏掉一条通道
    assert.ok(!tools.includes("powershell"));
  });

  it("白名单里没有一个认识的名字时给空集，不退回继承（那是权限放大）", () => {
    const registry = loadAgentRegistry({
      cwd: "/tmp",
      appHome: "/tmp",
      // Claude 生态常按自己的工具名写（大写），本项目认不出任何一个
      pluginAgents: [pluginAgent({ tools: ["Bash", "Read", "Glob"] })],
    });

    assert.deepEqual(registry.subagents["my-plugin-reviewer"]?.capability.toolSelection, {
      kind: "allowlist",
      tools: [],
    });
  });

  it("模型声明透传，权限规则留空（插件的权限只能由模式侧收紧）", () => {
    const registry = loadAgentRegistry({
      cwd: "/tmp",
      appHome: "/tmp",
      pluginAgents: [pluginAgent({ model: "gpt-5" })],
    });

    assert.equal(registry.subagents["my-plugin-reviewer"]?.capability.model, "gpt-5");
    assert.deepEqual(registry.subagents["my-plugin-reviewer"]?.capability.permissions, []);
  });
});
