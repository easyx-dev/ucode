/**
 * 门控单测：浏览器工具与「执行命令」同档——只读模式阻断页面操作、放行观察面，白名单会话拿不到，
 * 自定义角色声明这些工具名时能被认可（`KNOWN_TOOL_NAMES` 认它，否则静默少一个工具）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BROWSER_ACT_TOOL_NAME,
  BROWSER_OBSERVE_TOOL_NAMES,
  BROWSER_TOOL_NAMES,
  isBrowserTool,
  isObservingBrowserTool,
} from "../../../features/browser/tools";
import { evaluateRules } from "../../permissions/engine";
import { KNOWN_TOOL_NAMES, READ_ONLY_TOOLS, WRITE_TOOLS } from "../../tools/names";
import { agentRules, PRIMARY_PROFILES } from "../profiles";

describe("浏览器工具的定位", () => {
  it("全部属于「会改变机器状态」的工具（只读模式据此决定阻断面）", () => {
    for (const name of BROWSER_TOOL_NAMES)
      assert.ok(WRITE_TOOLS.includes(name), `${name} 应在 WRITE_TOOLS 里`);
  });

  it("观察面覆盖除 browser_act 以外的全部浏览器工具", () => {
    for (const name of BROWSER_OBSERVE_TOOL_NAMES)
      assert.ok(isBrowserTool(name), `${name} 应在 BROWSER_TOOL_NAMES 里`);
    assert.equal(isObservingBrowserTool(BROWSER_ACT_TOOL_NAME), false);
    // 新增浏览器工具时这条会失败：逼着作者明确它属于观察面还是操作面
    assert.deepEqual(
      [...BROWSER_OBSERVE_TOOL_NAMES, BROWSER_ACT_TOOL_NAME].sort(),
      [...BROWSER_TOOL_NAMES].sort(),
    );
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
  it("plan / ask 阻断页面操作（browser_act），观察面照常可用", () => {
    for (const mode of ["plan", "ask"] as const) {
      const rules = agentRules(PRIMARY_PROFILES[mode]);
      // 页面操作只在受管实例里放行：拿不到实例上下文（attach / 桌面端面板）时走兑底 deny
      assert.equal(
        evaluateRules(rules, { tool: BROWSER_ACT_TOOL_NAME, subject: "" }).action,
        "deny",
      );
      assert.equal(
        evaluateRules(rules, {
          tool: BROWSER_ACT_TOOL_NAME,
          subject: "",
          managedBrowser: true,
        }).action,
        "allow",
      );
      // 打开页面落回默认规则的按站点审批；其余观察类工具按默认放行
      assert.equal(
        evaluateRules(rules, { tool: "browser_open", subject: "example.com" }).action,
        "ask",
      );
      for (const name of ["browser_snapshot", "browser_screenshot", "browser_close"]) {
        assert.equal(
          evaluateRules(rules, { tool: name, subject: "" }).action,
          "allow",
          `${mode} 应放行 ${name}`,
        );
      }
    }
  });

  it("规则文案把「页面操作」与写盘 / 执行命令分开说", () => {
    const rules = agentRules(PRIMARY_PROFILES.plan);
    const actRule = rules.find(
      (rule) => rule.tool === BROWSER_ACT_TOOL_NAME && rule.action === "deny",
    );
    assert.match(actRule?.note ?? "", /只放行受管实例里的页面操作/);
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
