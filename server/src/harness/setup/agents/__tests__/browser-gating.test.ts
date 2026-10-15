/**
 * 门控单测：浏览器工具必须与「执行命令」同档——只读模式整批阻断、白名单会话拿不到、
 * 自定义角色声明这些工具名时能被认可（`KNOWN_TOOL_NAMES` 认它，否则静默少一个工具）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BROWSER_TOOL_NAMES, isBrowserTool } from "../../../features/browser/tools";
import { evaluateRules } from "../../permissions/engine";
import { KNOWN_TOOL_NAMES, READ_ONLY_TOOLS, WRITE_TOOLS } from "../../tools/names";
import { agentRules, PRIMARY_PROFILES } from "../profiles";

describe("浏览器工具的定位", () => {
  it("全部属于「会改变机器状态」的工具（只读模式据此整批 deny）", () => {
    for (const name of BROWSER_TOOL_NAMES)
      assert.ok(WRITE_TOOLS.includes(name), `${name} 应在 WRITE_TOOLS 里`);
  });

  it("不属于只读工具（explore 这类只读角色不该拿到它）", () => {
    for (const name of BROWSER_TOOL_NAMES) {
      assert.equal((READ_ONLY_TOOLS as readonly string[]).includes(name), false);
    }
  });

  it("已知工具名里包含它们，自定义角色的 tools 声明才不会被判非法", () => {
    for (const name of BROWSER_TOOL_NAMES)
      assert.ok(KNOWN_TOOL_NAMES.has(name), `${name} 应在 KNOWN_TOOL_NAMES 里`);
  });

  it("isBrowserTool 只认浏览器工具", () => {
    assert.equal(isBrowserTool("browser_open"), true);
    assert.equal(isBrowserTool("bash"), false);
  });
});

describe("只读模式", () => {
  it("plan / ask 对每个浏览器工具都给出 deny 规则", () => {
    for (const mode of ["plan", "ask"] as const) {
      const rules = agentRules(PRIMARY_PROFILES[mode]);
      for (const name of BROWSER_TOOL_NAMES) {
        const verdict = evaluateRules(rules, { tool: name, subject: "example.com" });
        assert.equal(verdict.action, "deny", `${mode} 应阻断 ${name}`);
      }
    }
  });

  it("规则文案把「操作浏览器」与写盘 / 执行命令分开说", () => {
    const rules = agentRules(PRIMARY_PROFILES.plan);
    // 规则是「最后命中者胜」：取最后一条，才拿到只读角色真正生效的那条
    const browserRule = rules.filter((rule) => rule.tool === "browser_open").at(-1);
    assert.match(browserRule?.note ?? "", /操作浏览器/);
  });

  it("编码模式下打开页面走审批（默认规则给的 ask），其余浏览器工具放行", () => {
    const rules = agentRules(PRIMARY_PROFILES.build);
    assert.equal(
      evaluateRules(rules, { tool: "browser_open", subject: "example.com" }).action,
      "ask",
    );
    assert.equal(evaluateRules(rules, { tool: "browser_act", subject: "" }).action, "allow");
  });
});
