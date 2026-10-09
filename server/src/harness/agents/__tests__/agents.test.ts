/**
 * 角色注册表与能力交集单测：覆盖计划「4.3 各阶段用例」的 SUB-01 / SUB-02。
 *
 * 交集是子智能体的安全底座，这里直接断言「子会话只能是父会话能力的子集」。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SESSION_MODES } from "@ucode/contracts";

import { DEFAULT_PERMISSION_RULES } from "../../permissions";
import { DEFAULT_BUILTIN_TOOLS, DEFAULT_EXTENSION_TOOLS } from "../../tools/names";
import {
  agentRules,
  effectiveToolNames,
  PRIMARY_PROFILES,
  parentModeRules,
  primaryCapability,
  resolveSubagentCapability,
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

describe("模式默认思考档位", () => {
  it("编码 / 问答声明自己的档位，计划留空跟全局设置走", () => {
    assert.equal(PRIMARY_PROFILES.build.capability.thinkingLevel, "high");
    assert.equal(PRIMARY_PROFILES.ask.capability.thinkingLevel, "medium");
    assert.equal(PRIMARY_PROFILES.plan.capability.thinkingLevel, undefined);
  });

  it("子角色不声明档位：编码降档不传导到委派出去的探索会话", () => {
    for (const slug of SUBAGENT_SLUGS) {
      assert.equal(
        SUBAGENT_PROFILES[slug].capability.thinkingLevel,
        undefined,
        `${slug} 不应声明档位`,
      );
    }
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
