/**
 * 权限引擎单测：覆盖计划「4.3 各阶段用例」的 P-01 ~ P-06。
 * 规则语义是「最后命中者胜」，越界路径与工具规则取更严的一档。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentRules, PRIMARY_PROFILES } from "../../agents";
import { DEFAULT_PERMISSION_RULES, skillDirectoryRules } from "../defaults";
import {
  applyApprovalMode,
  decidePermission,
  evaluateRules,
  externalScope,
  matchPattern,
  type PermissionRule,
} from "../engine";

const CWD = "/work";

describe("matchPattern", () => {
  it("`*` 跨路径分隔符匹配", () => {
    assert.equal(matchPattern("*.env", "config/.env"), true);
    assert.equal(matchPattern("plans/**", "plans/a/b.md"), true);
    assert.equal(matchPattern("plans/**", "src/a.ts"), false);
  });

  it("其余字符按字面量处理", () => {
    assert.equal(matchPattern("a+b", "a+b"), true);
    assert.equal(matchPattern("a+b", "aab"), false);
  });
});

describe("decidePermission", () => {
  it("P-04 最后命中者胜：越具体的规则覆盖前面的通配", () => {
    const rules: PermissionRule[] = [
      { tool: "bash", pattern: "*", action: "ask" },
      { tool: "bash", pattern: "git *", action: "allow" },
      { tool: "bash", pattern: "git push *", action: "deny" },
    ];
    assert.equal(evaluateRules(rules, { tool: "bash", subject: "ls" }).action, "ask");
    assert.equal(evaluateRules(rules, { tool: "bash", subject: "git status" }).action, "allow");
    assert.equal(
      evaluateRules(rules, { tool: "bash", subject: "git push origin main" }).action,
      "deny",
    );
  });

  it("P-02 读取 .env 被拦，.env.example 放行", () => {
    const denied = decidePermission(DEFAULT_PERMISSION_RULES, "read", { path: ".env" }, CWD);
    assert.equal(denied.action, "deny");

    const example = decidePermission(
      DEFAULT_PERMISSION_RULES,
      "read",
      { path: ".env.example" },
      CWD,
    );
    assert.equal(example.action, "allow");
  });

  it("执行类工具按方言判只读：PowerShell 里反斜杠不是转义", () => {
    const rules = agentRules(PRIMARY_PROFILES.plan);
    // 同一串文本，在 bash 与 PowerShell 下的含义不同：bash 里 `\;` 是字面量，PowerShell 里它是第二条命令前的分隔符
    assert.equal(
      decidePermission(rules, "bash", { command: "cat a\\; rm -rf ." }, CWD).action,
      "allow",
    );
    assert.equal(
      decidePermission(
        rules,
        "powershell",
        { command: "Get-ChildItem C:\\; Remove-Item -Recurse -Force C:\\data" },
        CWD,
      ).action,
      "deny",
    );
    assert.equal(
      decidePermission(rules, "powershell", { command: "Get-Content README.md" }, CWD).action,
      "allow",
    );
  });

  it("P-03 越界路径触发 external_directory，授权范围是父目录", () => {
    const verdict = decidePermission(
      DEFAULT_PERMISSION_RULES,
      "read",
      { path: "/etc/passwd" },
      CWD,
    );
    assert.equal(verdict.action, "ask");
    assert.equal(verdict.tool, "external_directory");
    assert.equal(verdict.scope, "/etc/**");
  });

  it("P-01 / P-06 plan / ask 模式阻断写盘，执行只放行只读命令", () => {
    for (const mode of ["plan", "ask"] as const) {
      const rules = agentRules(PRIMARY_PROFILES[mode]);
      assert.equal(decidePermission(rules, "edit", { path: "src/a.ts" }, CWD).action, "deny");
      assert.equal(decidePermission(rules, "write", { path: "src/a.ts" }, CWD).action, "deny");
      for (const command of ["ls -la", "git log --oneline", "cat a.md | head -3", "cd src && ls"]) {
        assert.equal(
          decidePermission(rules, "bash", { command }, CWD).action,
          "allow",
          `${mode} 应放行只读命令：${command}`,
        );
      }
      for (const command of [
        "rm -rf .",
        "pnpm check",
        "ls > out",
        "git commit -m x",
        "echo $HOME",
      ]) {
        assert.equal(
          decidePermission(rules, "bash", { command }, CWD).action,
          "deny",
          `${mode} 应阻断：${command}`,
        );
      }
      // 兜底规则的文案要说清「只放行只读命令」，模型据此知道还能跑什么
      const verdict = decidePermission(rules, "bash", { command: "pnpm check" }, CWD);
      assert.match(verdict.rule?.note ?? "", /只允许只读命令/);
    }
  });

  it("上下文条件（when）：条件为真才命中，缺省与为假都不命中", () => {
    const rules: PermissionRule[] = [
      { tool: "bash", pattern: "*", action: "deny" },
      { tool: "bash", pattern: "*", action: "allow", when: "readOnlyCommand" },
    ];
    assert.equal(
      evaluateRules(rules, { tool: "bash", subject: "ls", readOnlyCommand: true }).action,
      "allow",
    );
    assert.equal(
      evaluateRules(rules, { tool: "bash", subject: "ls", readOnlyCommand: false }).action,
      "deny",
    );
    // 不带条件的探测（`isReadOnlyCapability` 就是这么问的）命不中放行那条
    assert.equal(evaluateRules(rules, { tool: "bash", subject: "ls" }).action, "deny");
  });

  it("会话状态条件经 decidePermission 传进来：受管实例才放行页面操作", () => {
    const rules = agentRules(PRIMARY_PROFILES.plan);
    assert.equal(decidePermission(rules, "browser_act", {}, CWD).action, "deny");
    assert.equal(
      decidePermission(rules, "browser_act", {}, CWD, { managedBrowser: true }).action,
      "allow",
    );
  });

  it("未知工具没有匹配规则时默认放行", () => {
    assert.equal(
      decidePermission(DEFAULT_PERMISSION_RULES, "webfetch", { url: "https://a" }, CWD).action,
      "allow",
    );
  });

  it("技能目录内的越界读取放行，其它越界仍审批", () => {
    const skillDir = "/Users/me/.agents/skills";
    const rules: PermissionRule[] = [
      ...DEFAULT_PERMISSION_RULES,
      ...skillDirectoryRules([skillDir]),
    ];
    assert.equal(
      decidePermission(rules, "read", { path: `${skillDir}/foo/SKILL.md` }, CWD).action,
      "allow",
    );
    assert.equal(decidePermission(rules, "read", { path: "/etc/passwd" }, CWD).action, "ask");
  });

  it("只读模式对技能目录的写仍被更严的阻断压住", () => {
    const skillDir = "/Users/me/.agents/skills";
    const rules: PermissionRule[] = [
      ...agentRules(PRIMARY_PROFILES.plan),
      ...skillDirectoryRules([skillDir]),
    ];
    assert.equal(
      decidePermission(rules, "write", { path: `${skillDir}/foo/SKILL.md` }, CWD).action,
      "deny",
    );
    assert.equal(
      decidePermission(rules, "read", { path: `${skillDir}/foo/SKILL.md` }, CWD).action,
      "allow",
    );
  });
});

describe("applyApprovalMode", () => {
  it("default 不改写任何判定", () => {
    assert.equal(applyApprovalMode("ask", "edit", "default"), "ask");
    assert.equal(applyApprovalMode("ask", "external_directory", "default"), "ask");
    assert.equal(applyApprovalMode("allow", "edit", "default"), "allow");
    assert.equal(applyApprovalMode("deny", "edit", "default"), "deny");
  });

  it("auto 放行常规工具的 ask，保留越界审批", () => {
    assert.equal(applyApprovalMode("ask", "edit", "auto"), "allow");
    assert.equal(applyApprovalMode("ask", "mcp__srv__write", "auto"), "allow");
    assert.equal(applyApprovalMode("ask", "external_directory", "auto"), "ask");
  });

  it("full 放行所有 ask，但不突破 deny / allow", () => {
    assert.equal(applyApprovalMode("ask", "external_directory", "full"), "allow");
    assert.equal(applyApprovalMode("ask", "edit", "full"), "allow");
    assert.equal(applyApprovalMode("deny", "edit", "full"), "deny");
    assert.equal(applyApprovalMode("allow", "edit", "full"), "allow");
  });
});

describe("externalScope", () => {
  it("取目标父目录并整目录通配", () => {
    assert.equal(externalScope("/etc/hosts"), "/etc/**");
    assert.equal(externalScope("/Users/me/repo/src/a.ts"), "/Users/me/repo/src/**");
  });

  it("目标本身在根目录时退回自身，避免 / ** 全盘放行", () => {
    assert.equal(externalScope("/tmp"), "/tmp/**");
  });
});
