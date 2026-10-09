/**
 * 角色注册表与能力交集单测：覆盖计划「4.3 各阶段用例」的 SUB-01 / SUB-02。
 *
 * 交集是子智能体的安全底座，这里直接断言「子会话只能是父会话能力的子集」。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SESSION_MODES } from "@ucode/contracts";

import { DEFAULT_RECOMMENDED_THINKING_LEVEL } from "../../../constants";
import { DEFAULT_PERMISSION_RULES } from "../../permissions";
import { DEFAULT_BUILTIN_TOOLS, DEFAULT_EXTENSION_TOOLS } from "../../tools/names";
import {
  type AgentRegistry,
  agentRules,
  effectiveToolNames,
  PRIMARY_PROFILES,
  parentModeRules,
  parseCustomAgent,
  primaryCapability,
  resolveSubagentCapability,
  resolveThinkingLevel,
  SUBAGENT_PROFILES,
  SUBAGENT_SLUGS,
  subagentProfile,
  usesDefaultToolSet,
} from "../index";

describe("角色注册表", () => {
  it("每个模式都有对应主角色", () => {
    for (const mode of SESSION_MODES) {
      assert.equal(PRIMARY_PROFILES[mode].slug, mode);
      assert.equal(PRIMARY_PROFILES[mode].kind, "primary");
    }
  });

  it("build 用默认集（内置 + 扩展），plan / ask 只读且含 subagent", () => {
    const build = PRIMARY_PROFILES.build.capability.toolSelection;
    assert.equal(build.kind, "defaultTools");
    if (build.kind === "defaultTools") {
      for (const name of [...DEFAULT_BUILTIN_TOOLS, ...DEFAULT_EXTENSION_TOOLS]) {
        assert.ok(build.defaultTools.includes(name), `build 默认集缺少 ${name}`);
      }
    }

    for (const mode of ["plan", "ask"] as const) {
      const selection = PRIMARY_PROFILES[mode].capability.toolSelection;
      assert.equal(selection.kind, "allowlist");
      if (selection.kind !== "allowlist") continue;
      for (const name of ["edit", "write", "bash"]) {
        assert.ok(!selection.tools.includes(name), `${mode} 不应有 ${name}`);
      }
      assert.ok(selection.tools.includes("subagent"), `${mode} 应能委派子智能体`);
    }
  });

  it("子角色都是 subagent", () => {
    for (const slug of SUBAGENT_SLUGS) {
      assert.equal(SUBAGENT_PROFILES[slug].kind, "subagent");
    }
  });

  it("未知子角色直接报错，不静默退回默认", () => {
    assert.throws(() => subagentProfile("nope"));
  });
});

describe("模式推荐思考档位", () => {
  it("内置三模式的推荐值：计划最高、编码低一档、问答最轻", () => {
    assert.equal(PRIMARY_PROFILES.plan.recommendedThinkingLevel, "max");
    assert.equal(PRIMARY_PROFILES.build.recommendedThinkingLevel, "xhigh");
    assert.equal(PRIMARY_PROFILES.ask.recommendedThinkingLevel, "medium");
  });

  it("子角色不声明推荐值：委派出去的会话按所属模式的推荐值跑", () => {
    for (const slug of SUBAGENT_SLUGS) {
      assert.equal(
        SUBAGENT_PROFILES[slug].recommendedThinkingLevel,
        undefined,
        `${slug} 不应声明推荐值`,
      );
    }
  });

  it("`auto` 按模式解析：自定义模式没声明推荐值时落到缺省档位", () => {
    assert.equal(resolveThinkingLevel("auto", "plan"), "max");
    assert.equal(resolveThinkingLevel("auto", "build"), "xhigh");
    assert.equal(resolveThinkingLevel("low", "build"), "low");

    const { profile } = parseCustomAgent(
      "my-mode",
      "---\nmode: primary\ndescription: 自定义模式\n---\n正文",
    );
    const registry: AgentRegistry = {
      primary: { [profile.slug]: profile },
      subagents: {},
      errors: [],
    };
    assert.equal(
      resolveThinkingLevel("auto", "my-mode", registry),
      DEFAULT_RECOMMENDED_THINKING_LEVEL,
    );
    // 未知 slug 回落默认模式（删掉自定义文件后旧会话仍要能打开）
    assert.equal(
      resolveThinkingLevel("auto", "gone-mode"),
      PRIMARY_PROFILES.build.recommendedThinkingLevel,
    );
  });
});

describe("能力交集", () => {
  it("explore 在 build 父下仍是只读", () => {
    const capability = resolveSubagentCapability(
      subagentProfile("explore"),
      primaryCapability("build"),
    );
    const names = effectiveToolNames(capability);
    for (const name of ["edit", "write", "bash", "subagent"]) {
      assert.ok(!names.includes(name), `explore 不应有 ${name}`);
    }
    assert.ok(names.includes("read"));
    assert.ok(names.includes("grep"));
  });

  it("general 继承 build：保留默认集，但排除 subagent 防递归", () => {
    const capability = resolveSubagentCapability(
      subagentProfile("general"),
      primaryCapability("build"),
    );
    assert.equal(capability.toolSelection.kind, "defaultTools");
    const names = effectiveToolNames(capability);
    assert.ok(!names.includes("subagent"));
    assert.ok(names.includes("edit") && names.includes("bash"));
  });

  it("general 在 plan 父下被交集收窄为只读，不能越权", () => {
    const capability = resolveSubagentCapability(
      subagentProfile("general"),
      primaryCapability("plan"),
    );
    const names = effectiveToolNames(capability);
    for (const name of ["edit", "write", "bash", "subagent", "present_plan"]) {
      assert.ok(!names.includes(name), `plan 下的 general 不应有 ${name}`);
    }
    assert.ok(names.includes("read"));
  });

  it("子角色规则含 subagent 禁递归，主角色规则里没有", () => {
    const child = agentRules(subagentProfile("general"));
    assert.ok(child.some((rule) => rule.tool === "subagent" && rule.action === "deny"));
    const parent = agentRules(PRIMARY_PROFILES.build);
    assert.ok(!parent.some((rule) => rule.tool === "subagent" && rule.action === "deny"));
  });

  it("usesDefaultToolSet：只有继承默认集的能力才够得着扩展工具（MCP / codemode）", () => {
    assert.equal(usesDefaultToolSet(primaryCapability("build")), true);
    assert.equal(
      usesDefaultToolSet(
        resolveSubagentCapability(subagentProfile("general"), primaryCapability("build")),
      ),
      true,
    );
    assert.equal(
      usesDefaultToolSet(
        resolveSubagentCapability(subagentProfile("explore"), primaryCapability("build")),
      ),
      false,
    );
    assert.equal(usesDefaultToolSet(primaryCapability("plan")), false);
  });

  it("父一侧施加的是模式规则：默认规则只留在子会话自己的规则里", () => {
    // 子会话的规则表自带默认规则（装配层见 session-config 的 `agentRules(profile)`），
    // 父一侧若照旧再带一份，用户在父会话放行的范围（「本会话恒允」、技能目录）会重新落回审批
    const child = agentRules(subagentProfile("general"));
    for (const rule of DEFAULT_PERMISSION_RULES) {
      assert.ok(child.includes(rule), "子会话规则表应含默认规则");
    }
    for (const mode of SESSION_MODES) {
      for (const rule of parentModeRules(mode)) {
        assert.ok(!DEFAULT_PERMISSION_RULES.includes(rule), `${mode} 的父一侧规则不该含默认规则`);
      }
    }

    const plan = parentModeRules("plan");
    for (const tool of ["edit", "write", "bash"]) {
      assert.ok(plan.some((rule) => rule.tool === tool && rule.action === "deny"));
    }
  });
});
