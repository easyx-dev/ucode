/**
 * 角色注册表与能力交集单测：覆盖计划「4.3 各阶段用例」的 SUB-01 / SUB-02。
 *
 * 交集是子智能体的安全底座，这里直接断言「子会话只能是父会话能力的子集」。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SESSION_MODES } from "@ucode/contracts";

import { DEFAULT_RECOMMENDED_THINKING_LEVEL } from "../../../../constants/session";
import { DEFAULT_PERMISSION_RULES, decidePermission } from "../../permissions";
import {
  DEFAULT_BUILTIN_TOOLS,
  DEFAULT_EXTENSION_TOOLS,
  isExecTool,
  WRITE_TOOLS,
} from "../../tools/names";
import {
  type AgentRegistry,
  agentRules,
  effectiveToolNames,
  isReadOnlyCapability,
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
} from "..";

describe("角色注册表", () => {
  it("每个模式都有对应主角色", () => {
    for (const mode of SESSION_MODES) {
      assert.equal(PRIMARY_PROFILES[mode].slug, mode);
      assert.equal(PRIMARY_PROFILES[mode].kind, "primary");
    }
  });

  it("plan / ask 与 build 用同一套工具声明，只读性落在规则上", () => {
    const build = PRIMARY_PROFILES.build.capability.toolSelection;
    assert.equal(build.kind, "defaultTools");
    const declared = build.kind === "defaultTools" ? build.defaultTools : [];
    for (const name of [...DEFAULT_BUILTIN_TOOLS, ...DEFAULT_EXTENSION_TOOLS]) {
      assert.ok(declared.includes(name), `build 默认集缺少 ${name}`);
    }

    // 切模式不再改工具表（否则模型会照上一轮的旧表回答）；plan 只多一个 present_plan
    for (const mode of ["plan", "ask"] as const) {
      const selection = PRIMARY_PROFILES[mode].capability.toolSelection;
      assert.equal(selection.kind, "defaultTools");
      if (selection.kind !== "defaultTools") continue;
      const expected = mode === "plan" ? [...declared, "present_plan"] : declared;
      assert.deepEqual([...selection.defaultTools].sort(), [...expected].sort());
    }
  });

  it("只读模式靠规则断掉写盘 / 执行，不靠收窄工具集", () => {
    const rules = parentModeRules("plan");
    for (const name of WRITE_TOOLS) {
      assert.ok(
        rules.some((rule) => rule.tool === name && rule.action === "deny" && rule.pattern === "*"),
        `plan 应 deny ${name}`,
      );
    }
    // 判断「能不能落盘」看规则：两个只读模式为真，编码为假
    assert.equal(isReadOnlyCapability(primaryCapability("plan")), true);
    assert.equal(isReadOnlyCapability(primaryCapability("ask")), true);
    assert.equal(isReadOnlyCapability(primaryCapability("build")), false);
  });

  it("只读判定要求写盘与执行工具全断：只禁一个不算只读", () => {
    const build = primaryCapability("build");
    const deny = (tool: string) => ({ tool, pattern: "*", action: "deny" as const });
    // 只断 bash：还有 edit / write 能落盘，不该因此拿不到扩展与目标结算工具
    assert.equal(isReadOnlyCapability({ ...build, permissions: [deny("bash")] }), false);
    // 限定对象的 deny 也不算全断
    assert.equal(
      isReadOnlyCapability({
        ...build,
        permissions: [{ tool: "write", pattern: "src/*", action: "deny" }],
      }),
      false,
    );
    assert.equal(
      isReadOnlyCapability({
        ...build,
        permissions: WRITE_TOOLS.map(deny),
      }),
      true,
    );
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

  it("general 在 plan 父下保留默认集，但要越权会被父规则拦住", () => {
    const capability = resolveSubagentCapability(
      subagentProfile("general"),
      primaryCapability("plan"),
    );
    assert.equal(capability.toolSelection.kind, "defaultTools");
    const names = effectiveToolNames(capability);
    // 子会话的工具声明不再被交集收窄（与父工具表一致），递归与计划提交仍被排除
    for (const name of ["edit", "write", "bash"]) {
      assert.ok(names.includes(name), `plan 下的 general 应仍声明 ${name}`);
    }
    for (const name of ["subagent", "present_plan"]) {
      assert.ok(!names.includes(name), `plan 下的 general 不应有 ${name}`);
    }
    // 真正的闸门：装配层把父会话模式的规则一并交给子会话，判定取较严者
    // （端到端行为见 permissions/__tests__/extension.test 的「父会话模式的 deny 仍然拦住子会话」）
    for (const tool of WRITE_TOOLS) {
      const verdict = decidePermission(
        parentModeRules("plan"),
        tool,
        isExecTool(tool) ? { command: "rm -rf ." } : { path: "/work/src/a.ts" },
        "/work",
      );
      assert.equal(verdict.action, "deny", `plan 父下 ${tool} 应被拦下`);
    }
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
    // 计划与编码同为默认集（只读与否看规则），扩展工具靠 isReadOnlyCapability 排除
    assert.equal(usesDefaultToolSet(primaryCapability("plan")), true);
    assert.equal(isReadOnlyCapability(primaryCapability("plan")), true);
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
    for (const tool of WRITE_TOOLS) {
      assert.ok(plan.some((rule) => rule.tool === tool && rule.action === "deny"));
    }
  });
});
